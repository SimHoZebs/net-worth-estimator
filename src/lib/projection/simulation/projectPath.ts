import { prepareScenarioPack } from "../scenario/prepareScenario";
import type {
	Account,
	AccountDelta,
	AccountSnapshot,
	IsoDate,
	MovementEvent,
	ProjectionAccountSummary,
	ProjectionPostingSummary,
	ProjectionRow,
	ProjectionRuntimeSettings,
	RawProjectionOutput,
	ScenarioPack,
	ScenarioWhatIfState,
} from "../types/scenario";
import {
	addYearsClamped,
	compareIsoDates,
	projectionYearIndex,
} from "../utils/date";
import {
	computeNetWorth,
	initAccountBalances,
	snapshotBalances,
} from "./accounts";
import type { DatedPostingOccurrence } from "./postings";
import {
	addOccurrences,
	applyPosting,
	computeRequestedAmount,
	resolvePostingMovement,
} from "./postings";

interface NormalizedCheckpoints {
	dates: Array<{
		date: IsoDate;
		checkpoints: ScenarioPack["checkpoints"];
	}>;
	earliestCheckpointDate: IsoDate | null;
	latestCheckpointDate: IsoDate | null;
}

function roundCurrency(value: number): number {
	return Math.round(value);
}

function normalizeCheckpoints(pack: ScenarioPack): NormalizedCheckpoints {
	const checkpoints = pack.checkpoints
		.map((checkpoint, index) => ({ checkpoint, index }))
		.sort(
			(left, right) =>
				compareIsoDates(left.checkpoint.Date, right.checkpoint.Date) ||
				left.index - right.index,
		);
	const groupedByDate = new Map<IsoDate, ScenarioPack["checkpoints"]>();

	checkpoints.forEach(({ checkpoint }) => {
		const existing = groupedByDate.get(checkpoint.Date);
		if (existing) {
			existing.push(checkpoint);
			return;
		}

		groupedByDate.set(checkpoint.Date, [checkpoint]);
	});

	const dates = Array.from(groupedByDate.entries()).map(
		([date, dateCheckpoints]) => ({
			date,
			checkpoints: dateCheckpoints,
		}),
	);

	return {
		dates,
		earliestCheckpointDate: dates[0]?.date ?? null,
		latestCheckpointDate: dates[dates.length - 1]?.date ?? null,
	};
}

function createRow({
	date,
	isHistorical,
	balances,
	accounts,
	accountImpacts,
	externalInflowAmount,
	externalOutflowAmount,
	internalTransferAmount,
	requestedPostingAmount,
	realizedPostingAmount,
	clampedPostingShortfallAmount,
	requestedPostingAmountsById,
	realizedPostingAmountsById,
}: {
	date: IsoDate;
	isHistorical: boolean;
	balances: Record<string, number>;
	accounts: Account[];
	accountImpacts: Record<string, AccountDelta[]>;
	externalInflowAmount: number;
	externalOutflowAmount: number;
	internalTransferAmount: number;
	requestedPostingAmount: number;
	realizedPostingAmount: number;
	clampedPostingShortfallAmount: number;
	requestedPostingAmountsById: Record<string, number>;
	realizedPostingAmountsById: Record<string, number>;
}): ProjectionRow {
	const accountSnapshots: AccountSnapshot[] = accounts.map((account) => ({
		accountId: account.id,
		date,
		balance: balances[account.id] ?? 0,
		impacts: accountImpacts[account.id] ?? [],
	}));

	return {
		date,
		isHistorical,
		netWorth: computeNetWorth(balances, accounts),
		accountSnapshots,
		externalInflowAmount,
		externalOutflowAmount,
		internalTransferAmount,
		requestedPostingAmount,
		realizedPostingAmount,
		clampedPostingShortfallAmount,
		requestedPostingAmountsById,
		realizedPostingAmountsById,
	};
}

function roundRow(row: ProjectionRow): ProjectionRow {
	return {
		...row,
		netWorth: roundCurrency(row.netWorth),
		externalInflowAmount: roundCurrency(row.externalInflowAmount),
		externalOutflowAmount: roundCurrency(row.externalOutflowAmount),
		internalTransferAmount: roundCurrency(row.internalTransferAmount),
		requestedPostingAmount: roundCurrency(row.requestedPostingAmount),
		realizedPostingAmount: roundCurrency(row.realizedPostingAmount),
		clampedPostingShortfallAmount: roundCurrency(
			row.clampedPostingShortfallAmount,
		),
		accountSnapshots: row.accountSnapshots.map((snap) => ({
			...snap,
			balance: roundCurrency(snap.balance),
			impacts: snap.impacts.map((impact) => ({
				...impact,
				delta: roundCurrency(impact.delta),
			})),
		})),
		requestedPostingAmountsById: Object.fromEntries(
			Object.entries(row.requestedPostingAmountsById).map(
				([postingId, amount]) => [postingId, roundCurrency(amount)],
			),
		),
		realizedPostingAmountsById: Object.fromEntries(
			Object.entries(row.realizedPostingAmountsById).map(
				([postingId, amount]) => [postingId, roundCurrency(amount)],
			),
		),
	};
}

export function projectRawScenarioPack(
	pack: ScenarioPack,
	projectionSettings: ProjectionRuntimeSettings,
	whatIfState?: ScenarioWhatIfState,
	stochasticRates?: Map<string, number[]>,
): RawProjectionOutput {
	const normalizedWhatIfState = whatIfState ?? {
		addedAccounts: [],
		addedPostings: [],
		addedCheckpoints: [],
		disabledAccountIds: [],
		disabledPostingIds: [],
	};
	const mergedPack = prepareScenarioPack(pack, normalizedWhatIfState);

	const normalizedCheckpoints = normalizeCheckpoints(mergedPack);
	const projectionStartDate =
		normalizedCheckpoints.latestCheckpointDate ??
		projectionSettings.fallbackProjectionStartDate;
	const projectionEndDate = addYearsClamped(
		projectionStartDate,
		projectionSettings.horizonYears,
	);
	const includeStartDateEvents =
		normalizedCheckpoints.latestCheckpointDate === null;
	const accountById = new Map(
		mergedPack.accounts.map((account) => [account.id, account]),
	);
	const rows: ProjectionRow[] = [];
	const movementEvents: MovementEvent[] = [];
	let movementSequence = 0;
	const balances = initAccountBalances(mergedPack.accounts);
	const futureStartingBalances = initAccountBalances(mergedPack.accounts);
	const latestRealizedPostingAmountById = new Map<string, number>();
	const realizedPostingAmountByIdAndYear = new Map<string, number>();
	const requestedPostingTotalsById = new Map(
		mergedPack.postings.map((posting) => [posting.id, 0]),
	);
	const realizedPostingTotalsById = new Map(
		mergedPack.postings.map((posting) => [posting.id, 0]),
	);
	const firstShortfallDateById = new Map<string, IsoDate>();
	let totalExternalInflowAmount = 0;
	let totalExternalOutflowAmount = 0;
	let totalInternalTransferAmount = 0;
	let totalRequestedPostingAmount = 0;
	let totalRealizedPostingAmount = 0;
	let totalClampedPostingShortfallAmount = 0;

	normalizedCheckpoints.dates.forEach(({ date, checkpoints }) => {
		checkpoints.forEach((checkpoint) => {
			balances[checkpoint.AccountId] = checkpoint.Balance;
		});

		rows.push(
			createRow({
				date,
				isHistorical: true,
				balances,
				accounts: mergedPack.accounts,
				accountImpacts: {},
				externalInflowAmount: 0,
				externalOutflowAmount: 0,
				internalTransferAmount: 0,
				requestedPostingAmount: 0,
				realizedPostingAmount: 0,
				clampedPostingShortfallAmount: 0,
				requestedPostingAmountsById: {},
				realizedPostingAmountsById: {},
			}),
		);
	});

	Object.assign(futureStartingBalances, balances);

	const eventDates = new Map<IsoDate, DatedPostingOccurrence[]>();
	addOccurrences(
		mergedPack.postings,
		eventDates,
		projectionStartDate,
		projectionEndDate,
		includeStartDateEvents,
	);

	const sortedProjectedDates = Array.from(eventDates.keys()).sort(
		compareIsoDates,
	);

	sortedProjectedDates.forEach((date) => {
		const occurrences = eventDates.get(date);
		if (!occurrences) {
			return;
		}

		const yearIndex = projectionYearIndex(projectionStartDate, date);

		const requestedPostingAmountsById: Record<string, number> = {};
		const realizedPostingAmountsById: Record<string, number> = {};
		const accountImpacts: Record<string, AccountDelta[]> = {};
		let externalInflowAmount = 0;
		let externalOutflowAmount = 0;
		let internalTransferAmount = 0;
		let requestedPostingAmount = 0;
		let realizedPostingAmount = 0;
		let clampedPostingShortfallAmount = 0;

		const sortedOccurrences = [...occurrences].sort(
			(left, right) =>
				left.posting.priority - right.posting.priority ||
				left.index - right.index,
		);

		sortedOccurrences.forEach((occurrence) => {
			const { posting } = occurrence;

			let stochasticRate: number | undefined;
			if (stochasticRates !== undefined && posting.volatility > 0) {
				const rates = stochasticRates.get(posting.id);
				if (rates && yearIndex >= 0 && yearIndex < rates.length) {
					stochasticRate = rates[yearIndex];
				}
			}

			const requestedAmount = Math.max(
				0,
				computeRequestedAmount(
					occurrence,
					date,
					latestRealizedPostingAmountById,
					balances,
					normalizedWhatIfState,
					stochasticRate,
				),
			);
			const capKey = `${posting.id}:${date.slice(0, 4)}`;
			const annualCapRemaining =
				posting.annualCap === null
					? Number.POSITIVE_INFINITY
					: Math.max(
							0,
							posting.annualCap -
								(realizedPostingAmountByIdAndYear.get(capKey) ?? 0),
						);
			const movement = resolvePostingMovement(
				posting,
				requestedAmount,
				annualCapRemaining,
				balances,
				accountById,
			);
			const { realizedAmount, shortfallAmount } = movement;

			if (shortfallAmount > 0 && !firstShortfallDateById.has(posting.id)) {
				firstShortfallDateById.set(posting.id, date);
			}

			requestedPostingAmountsById[posting.id] = requestedAmount;
			realizedPostingAmountsById[posting.id] = realizedAmount;
			requestedPostingAmount += requestedAmount;
			realizedPostingAmount += realizedAmount;
			clampedPostingShortfallAmount += shortfallAmount;
			totalRequestedPostingAmount += requestedAmount;
			totalRealizedPostingAmount += realizedAmount;
			totalClampedPostingShortfallAmount += shortfallAmount;
			requestedPostingTotalsById.set(
				posting.id,
				(requestedPostingTotalsById.get(posting.id) ?? 0) + requestedAmount,
			);
			realizedPostingTotalsById.set(
				posting.id,
				(realizedPostingTotalsById.get(posting.id) ?? 0) + realizedAmount,
			);
			realizedPostingAmountByIdAndYear.set(
				capKey,
				(realizedPostingAmountByIdAndYear.get(capKey) ?? 0) + realizedAmount,
			);

			const beforeBalances = snapshotBalances(balances);
			applyPosting(posting, realizedAmount, balances, accountById);
			const accountDeltas: MovementEvent["accountDeltas"] = [];
			for (const [accountId, after] of Object.entries(balances)) {
				const before = beforeBalances[accountId] ?? 0;
				if (before !== after) {
					const delta = after - before;
					if (!accountImpacts[accountId]) accountImpacts[accountId] = [];
					accountImpacts[accountId].push({
						postingId: posting.id,
						delta,
					});
					accountDeltas.push({ accountId, delta });
				}
			}
			movementEvents.push({
				date,
				sequence: movementSequence++,
				origin: { type: "posting", postingId: posting.id },
				requestedAmount: movement.requestedAmount,
				realizedAmount: movement.realizedAmount,
				bindingConstraints: movement.bindingConstraints,
				accountDeltas,
			});
			latestRealizedPostingAmountById.set(posting.id, realizedAmount);

			if (posting.sourceAccountId === null && posting.destinations !== null) {
				externalInflowAmount += realizedAmount;
				totalExternalInflowAmount += realizedAmount;
				return;
			}

			if (posting.sourceAccountId !== null && posting.destinations === null) {
				externalOutflowAmount += realizedAmount;
				totalExternalOutflowAmount += realizedAmount;
				return;
			}

			if (posting.sourceAccountId !== null && posting.destinations !== null) {
				internalTransferAmount += realizedAmount;
				totalInternalTransferAmount += realizedAmount;
			}
		});

		rows.push(
			createRow({
				date,
				isHistorical: false,
				balances,
				accounts: mergedPack.accounts,
				accountImpacts,
				externalInflowAmount,
				externalOutflowAmount,
				internalTransferAmount,
				requestedPostingAmount,
				realizedPostingAmount,
				clampedPostingShortfallAmount,
				requestedPostingAmountsById,
				realizedPostingAmountsById,
			}),
		);
	});

	const sampledRows = rows;
	const latestHistoricalRow =
		[...rows].reverse().find((row) => row.isHistorical) ?? null;
	const latestRow = rows[rows.length - 1] ?? null;
	const currentNetWorth =
		latestHistoricalRow?.netWorth ??
		computeNetWorth(futureStartingBalances, mergedPack.accounts);
	const endingSnapshotsByAccountId = new Map<string, AccountSnapshot>();
	if (latestRow) {
		for (const snapshot of latestRow.accountSnapshots) {
			endingSnapshotsByAccountId.set(snapshot.accountId, snapshot);
		}
	}
	const accountSummaries: ProjectionAccountSummary[] = mergedPack.accounts.map(
		(account) => {
			const endingSnapshot = endingSnapshotsByAccountId.get(account.id);
			const endingBalance =
				endingSnapshot?.balance ?? futureStartingBalances[account.id] ?? 0;
			const startingBalance = futureStartingBalances[account.id] ?? 0;

			return {
				accountId: account.id,
				label: account.label,
				color: account.color,
				enabled: account.enabled,
				startingBalance: roundCurrency(startingBalance),
				endingBalance: roundCurrency(endingBalance),
			};
		},
	);

	const postingSummaries: ProjectionPostingSummary[] = mergedPack.postings.map(
		(posting) => {
			const requestedAmount = requestedPostingTotalsById.get(posting.id) ?? 0;
			const realizedAmount = realizedPostingTotalsById.get(posting.id) ?? 0;

			return {
				postingId: posting.id,
				label: posting.label,
				sourceAccountId: posting.sourceAccountId,
				sourceAccountLabel: posting.sourceAccountId
					? (accountById.get(posting.sourceAccountId)?.label ??
						posting.sourceAccountId)
					: null,
				destinations: posting.destinations
					? posting.destinations.map((destId) => ({
							accountId: destId,
							label: accountById.get(destId)?.label ?? destId,
						}))
					: null,
				priority: posting.priority,
				annualCap: posting.annualCap,
				requestedAmount: roundCurrency(requestedAmount),
				realizedAmount: roundCurrency(realizedAmount),
				utilizationRate:
					requestedAmount > 0 ? realizedAmount / requestedAmount : 0,
				firstShortfallDate: firstShortfallDateById.get(posting.id) ?? null,
				shortfallAmount: roundCurrency(requestedAmount - realizedAmount),
			};
		},
	);

	return {
		path: {
			rows,
			movementEvents,
			effectivePack: mergedPack,
			projectionStartDate,
			projectionEndDate,
		},
		result: {
			timeline: {
				rows: rows.map(roundRow),
				sampledRows: sampledRows.map(roundRow),
			},
			accountSummaries,
			postingSummaries,
			totals: {
				externalInflowAmount: roundCurrency(totalExternalInflowAmount),
				externalOutflowAmount: roundCurrency(totalExternalOutflowAmount),
				internalTransferAmount: roundCurrency(totalInternalTransferAmount),
				requestedPostingAmount: roundCurrency(totalRequestedPostingAmount),
				realizedPostingAmount: roundCurrency(totalRealizedPostingAmount),
				clampedPostingShortfallAmount: roundCurrency(
					totalClampedPostingShortfallAmount,
				),
			},
			milestones: {
				latestCheckpointDate: normalizedCheckpoints.latestCheckpointDate,
				latestHistoricalDate: latestHistoricalRow?.date ?? null,
				projectionStartDate,
			},
			summary: {
				currentNetWorth: roundCurrency(currentNetWorth),
				finalNetWorth: roundCurrency(latestRow?.netWorth ?? currentNetWorth),
			},
		},
	};
}
