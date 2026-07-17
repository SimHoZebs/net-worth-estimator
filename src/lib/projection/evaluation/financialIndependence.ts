import { runReactiveBehavior } from "../behavior/runtime";
import { EMPTY_WHAT_IF_STATE } from "../scenario/prepareScenario";
import { getWithdrawableAmount } from "../simulation/accounts";
import {
	addOccurrences,
	applyAccountMovement,
	applyPosting,
	computeRequestedAmount,
	type DatedPostingOccurrence,
	resolveAccountMovementAmount,
	resolvePostingAmount,
} from "../simulation/postings";
import type {
	Account,
	FinancialIndependenceAnalysis,
	FinancialIndependencePlan,
	FinancialIndependenceRow,
	FinancialIndependenceRunOutcome,
	IsoDate,
	ProjectionPath,
	ProjectionRow,
} from "../types/scenario";
import {
	addMonthsClamped,
	addYearsClamped,
	compareIsoDates,
	daysBetween,
} from "../utils/date";

const EPSILON = 0.01;

export const DEFAULT_FI_PLAN: FinancialIndependencePlan = {
	minimumNetWorth: 0,
	annualExpenseTarget: 0,
	annualExpenseGrowthRate: 0,
	withdrawalRate: 0,
	evaluationYears: 1,
	requiredConfidence: 1,
	sources: [],
	continuingPostingIds: [],
	principalPolicy: "allow-drawdown",
};

function finiteNonNegative(value: number, fallback = 0): number {
	return Number.isFinite(value) ? Math.max(0, value) : fallback;
}

export function normalizeFinancialIndependencePlan(
	plan: FinancialIndependencePlan,
): FinancialIndependencePlan {
	return {
		...plan,
		minimumNetWorth: finiteNonNegative(plan.minimumNetWorth),
		annualExpenseTarget: finiteNonNegative(plan.annualExpenseTarget),
		annualExpenseGrowthRate: finiteNonNegative(plan.annualExpenseGrowthRate),
		withdrawalRate: Math.min(1, finiteNonNegative(plan.withdrawalRate)),
		evaluationYears: Math.max(
			1,
			Math.floor(finiteNonNegative(plan.evaluationYears, 1)),
		),
		requiredConfidence: Math.min(
			1,
			Math.max(0.01, finiteNonNegative(plan.requiredConfidence, 1)),
		),
		sources: plan.sources.map((source) =>
			source.type === "asset" && source.withdrawalRateOverride !== undefined
				? {
						...source,
						withdrawalRateOverride: Math.min(
							1,
							finiteNonNegative(source.withdrawalRateOverride),
						),
					}
				: source,
		),
		continuingPostingIds: [...new Set(plan.continuingPostingIds)],
	};
}

export function buildFinancialIndependenceCandidateDates(
	projectionStartDate: IsoDate,
	projectionEndDate: IsoDate,
	evaluationYears: number,
): IsoDate[] {
	const dates: IsoDate[] = [];
	for (let month = 0; ; month++) {
		const date = addMonthsClamped(projectionStartDate, month);
		if (addYearsClamped(date, evaluationYears) > projectionEndDate) break;
		dates.push(date);
	}
	return dates;
}

function selectedAssetRates(plan: FinancialIndependencePlan) {
	const rates = new Map<string, number>();
	for (const source of plan.sources) {
		if (source.type !== "asset" || !source.included) continue;
		rates.set(
			source.accountId,
			source.withdrawalRateOverride ?? plan.withdrawalRate,
		);
	}
	return rates;
}

function selectedCashflowIds(plan: FinancialIndependencePlan) {
	return new Set(
		plan.sources.flatMap((source) =>
			source.type === "cashflow" && source.included ? [source.postingId] : [],
		),
	);
}

function latestRowAtOrBefore(rows: readonly ProjectionRow[], date: IsoDate) {
	let low = 0;
	let high = rows.length - 1;
	let match: ProjectionRow | null = null;
	while (low <= high) {
		const middle = Math.floor((low + high) / 2);
		const row = rows[middle];
		if (row.date <= date) {
			match = row;
			low = middle + 1;
		} else {
			high = middle - 1;
		}
	}
	return match;
}

function balancesAt(row: ProjectionRow | null, accounts: readonly Account[]) {
	const balances = Object.fromEntries(
		accounts.map((account) => [account.id, 0]),
	);
	for (const snapshot of row?.accountSnapshots ?? []) {
		balances[snapshot.accountId] = snapshot.balance;
	}
	return balances;
}

function balanceAt(row: ProjectionRow, accountId: string) {
	return (
		row.accountSnapshots.find((snapshot) => snapshot.accountId === accountId)
			?.balance ?? 0
	);
}

function expenseAt(
	plan: FinancialIndependencePlan,
	projectionStartDate: IsoDate,
	date: IsoDate,
) {
	const years = Math.max(0, daysBetween(projectionStartDate, date) / 365.2425);
	return plan.annualExpenseTarget * (1 + plan.annualExpenseGrowthRate) ** years;
}

function realizedCashflowBetween(
	rows: readonly ProjectionRow[],
	cashflowIds: ReadonlySet<string>,
	startDate: IsoDate,
	endDate: IsoDate,
) {
	let total = 0;
	for (const row of rows) {
		if (row.date <= startDate) continue;
		if (row.date > endDate) break;
		for (const postingId of cashflowIds) {
			total += row.realizedPostingAmountsById[postingId] ?? 0;
		}
	}
	return total;
}

function initializeLatestPostingAmounts(
	rows: readonly ProjectionRow[],
	candidateDate: IsoDate,
) {
	const latest = new Map<string, number>();
	for (const row of rows) {
		if (row.date > candidateDate) break;
		for (const [postingId, amount] of Object.entries(
			row.realizedPostingAmountsById,
		)) {
			latest.set(postingId, amount);
		}
	}
	return latest;
}

function initializeRealizedPostingCaps(
	rows: readonly ProjectionRow[],
	candidateDate: IsoDate,
	postingIds: ReadonlySet<string>,
) {
	const realized = new Map<string, number>();
	for (const row of rows) {
		if (row.date > candidateDate) break;
		for (const [postingId, amount] of Object.entries(
			row.realizedPostingAmountsById,
		)) {
			if (!postingIds.has(postingId)) continue;
			const key = `${postingId}:${row.date.slice(0, 4)}`;
			realized.set(key, (realized.get(key) ?? 0) + amount);
		}
	}
	return realized;
}

function applyContinuingPostings({
	events,
	balances,
	accountsById,
	latestPostingAmounts,
	realizedByPostingAndYear,
	projectionStartDate,
	stochasticRates,
}: {
	events: readonly (readonly [IsoDate, readonly DatedPostingOccurrence[]])[];
	balances: Record<string, number>;
	accountsById: Map<string, Account>;
	latestPostingAmounts: Map<string, number>;
	realizedByPostingAndYear: Map<string, number>;
	projectionStartDate: IsoDate;
	stochasticRates?: ReadonlyMap<string, readonly number[]>;
}) {
	for (const [date, occurrences] of events) {
		const sorted = [...occurrences].sort(
			(left, right) =>
				left.posting.priority - right.posting.priority ||
				left.index - right.index,
		);
		for (const occurrence of sorted) {
			const { posting } = occurrence;
			const yearIndex = Math.floor(
				daysBetween(projectionStartDate, date) / 365,
			);
			const sampledRate = stochasticRates?.get(posting.id)?.[yearIndex];
			const requestedAmount = Math.max(
				0,
				computeRequestedAmount(
					occurrence,
					date,
					latestPostingAmounts,
					balances,
					EMPTY_WHAT_IF_STATE,
					sampledRate,
				),
			);
			const capKey = `${posting.id}:${date.slice(0, 4)}`;
			const capRemaining =
				posting.annualCap === null
					? Number.POSITIVE_INFINITY
					: Math.max(
							0,
							posting.annualCap - (realizedByPostingAndYear.get(capKey) ?? 0),
						);
			const realizedAmount = resolvePostingAmount(
				posting,
				requestedAmount,
				capRemaining,
				balances,
				accountsById,
			);
			applyPosting(posting, realizedAmount, balances, accountsById);
			latestPostingAmounts.set(posting.id, realizedAmount);
			realizedByPostingAndYear.set(
				capKey,
				(realizedByPostingAndYear.get(capKey) ?? 0) + realizedAmount,
			);
		}
	}
}

function evaluateCycle({
	path,
	plan,
	candidate,
	stochasticRates,
}: {
	path: ProjectionPath;
	plan: FinancialIndependencePlan;
	candidate: FinancialIndependenceRow;
	stochasticRates?: ReadonlyMap<string, readonly number[]>;
}): FinancialIndependenceRunOutcome {
	const candidateRow = latestRowAtOrBefore(path.rows, candidate.date);
	if (!candidate.isEligible) {
		return {
			candidateDate: candidate.date,
			status: "ineligible",
			minimumNetWorthMet: candidate.minimumNetWorthMet,
			initialCoverageMet: candidate.isCovered,
			expensesFullyCovered: false,
			hadWithdrawalShortfall: false,
			startingSelectedAssetBalance: candidate.selectedAssetBalance,
			endingSelectedAssetBalance: candidate.selectedAssetBalance,
			startingRealSelectedAssetBalance: candidate.selectedAssetBalance,
			endingRealSelectedAssetBalance: candidate.selectedAssetBalance,
			principalReplenished: false,
			cycleEstablished: false,
		};
	}

	const assetRates = selectedAssetRates(plan);
	const cashflowIds = selectedCashflowIds(plan);
	const accountsById = new Map(
		path.effectivePack.accounts.map((account) => [account.id, account]),
	);
	const balances = balancesAt(candidateRow, path.effectivePack.accounts);
	const startingSelectedAssetBalance = [...assetRates.keys()].reduce(
		(sum, accountId) => sum + Math.max(0, balances[accountId] ?? 0),
		0,
	);
	const continuingIds = new Set(
		plan.continuingPostingIds.filter((id) => !cashflowIds.has(id)),
	);
	const continuingPostings = path.effectivePack.postings.filter(
		(posting) => posting.enabled && continuingIds.has(posting.id),
	);
	const eventDates = new Map<IsoDate, DatedPostingOccurrence[]>();
	const cycleEnd = addYearsClamped(candidate.date, plan.evaluationYears);
	addOccurrences(
		continuingPostings,
		eventDates,
		candidate.date,
		cycleEnd,
		false,
	);
	const periods = Array.from(
		{ length: plan.evaluationYears * 12 },
		(_, index) => ({
			index,
			startDate: addMonthsClamped(candidate.date, index),
			endDate: addMonthsClamped(candidate.date, index + 1),
		}),
	);
	const eventsByPeriod = periods.map(
		() => [] as Array<readonly [IsoDate, readonly DatedPostingOccurrence[]]>,
	);
	let periodIndex = 0;
	for (const event of [...eventDates].sort(([left], [right]) =>
		compareIsoDates(left, right),
	)) {
		while (
			periodIndex < periods.length &&
			event[0] > periods[periodIndex].endDate
		) {
			periodIndex++;
		}
		if (
			periodIndex < periods.length &&
			event[0] > periods[periodIndex].startDate
		) {
			eventsByPeriod[periodIndex].push(event);
		}
	}

	return runReactiveBehavior(periods, {
		initialize: () => ({
			hadWithdrawalShortfall: false,
			remainingWithdrawalByAccount: new Map<string, number>(),
			latestPostingAmounts: initializeLatestPostingAmounts(
				path.rows,
				candidate.date,
			),
			realizedByPostingAndYear: initializeRealizedPostingCaps(
				path.rows,
				candidate.date,
				continuingIds,
			),
		}),
		react: (state, period) => {
			if (period.index % 12 === 0) {
				state.remainingWithdrawalByAccount = new Map(
					[...assetRates].map(([accountId, rate]) => [
						accountId,
						Math.max(0, balances[accountId] ?? 0) * rate,
					]),
				);
			}

			applyContinuingPostings({
				events: eventsByPeriod[period.index],
				balances,
				accountsById,
				latestPostingAmounts: state.latestPostingAmounts,
				realizedByPostingAndYear: state.realizedByPostingAndYear,
				projectionStartDate: path.projectionStartDate,
				stochasticRates,
			});

			const directIncome = realizedCashflowBetween(
				path.rows,
				cashflowIds,
				period.startDate,
				period.endDate,
			);
			let remainingExpense = Math.max(
				0,
				expenseAt(plan, path.projectionStartDate, period.startDate) / 12 -
					directIncome,
			);
			const capacities = [...assetRates.keys()].map((accountId) => {
				const account = accountsById.get(accountId);
				const positiveBalance = Math.max(0, balances[accountId] ?? 0);
				const accountLimit = account
					? getWithdrawableAmount(balances, accountsById, accountId)
					: 0;
				return {
					accountId,
					capacity: Math.min(
						positiveBalance,
						accountLimit,
						state.remainingWithdrawalByAccount.get(accountId) ?? 0,
					),
				};
			});
			const totalCapacity = capacities.reduce(
				(sum, item) => sum + item.capacity,
				0,
			);
			const requestedExpense = remainingExpense;
			for (const { accountId, capacity } of capacities) {
				if (remainingExpense <= EPSILON || totalCapacity <= 0) break;
				const requestedAmount = Math.min(
					capacity,
					requestedExpense * (capacity / totalCapacity),
				);
				const action = {
					sourceAccountId: accountId,
					destinations: null,
					requestedAmount,
					limitRemaining: capacity,
				};
				const realizedAmount = Math.min(
					Math.max(0, balances[accountId] ?? 0),
					resolveAccountMovementAmount(action, balances, accountsById),
				);
				applyAccountMovement(action, realizedAmount, balances, accountsById);
				state.remainingWithdrawalByAccount.set(
					accountId,
					Math.max(
						0,
						(state.remainingWithdrawalByAccount.get(accountId) ?? 0) -
							realizedAmount,
					),
				);
				remainingExpense -= realizedAmount;
			}
			if (remainingExpense > EPSILON) state.hadWithdrawalShortfall = true;
		},
		finish: (state) => {
			const endingSelectedAssetBalance = [...assetRates.keys()].reduce(
				(sum, accountId) => sum + Math.max(0, balances[accountId] ?? 0),
				0,
			);
			const inflationFactor =
				(1 + plan.annualExpenseGrowthRate) ** plan.evaluationYears;
			const endingRealSelectedAssetBalance =
				endingSelectedAssetBalance / inflationFactor;
			const principalReplenished =
				plan.principalPolicy === "allow-drawdown" ||
				(plan.principalPolicy === "preserve-nominal-principal"
					? endingSelectedAssetBalance + EPSILON >= startingSelectedAssetBalance
					: endingRealSelectedAssetBalance + EPSILON >=
						startingSelectedAssetBalance);
			return {
				candidateDate: candidate.date,
				status: "evaluated" as const,
				minimumNetWorthMet: true,
				initialCoverageMet: true,
				expensesFullyCovered: !state.hadWithdrawalShortfall,
				hadWithdrawalShortfall: state.hadWithdrawalShortfall,
				startingSelectedAssetBalance,
				endingSelectedAssetBalance,
				startingRealSelectedAssetBalance: startingSelectedAssetBalance,
				endingRealSelectedAssetBalance,
				principalReplenished,
				cycleEstablished: !state.hadWithdrawalShortfall && principalReplenished,
			};
		},
	});
}

export function evaluateFinancialIndependence({
	path,
	plan,
	stochasticRates,
	candidateDates,
}: {
	path: ProjectionPath;
	plan: FinancialIndependencePlan;
	stochasticRates?: ReadonlyMap<string, readonly number[]>;
	candidateDates?: readonly IsoDate[];
}): FinancialIndependenceAnalysis {
	const normalizedPlan = normalizeFinancialIndependencePlan(plan);
	const projectedRows = path.rows.filter((row) => !row.isHistorical);
	const assetRates = selectedAssetRates(normalizedPlan);
	const cashflowIds = selectedCashflowIds(normalizedPlan);
	const dates =
		candidateDates ??
		buildFinancialIndependenceCandidateDates(
			path.projectionStartDate,
			path.projectionEndDate,
			normalizedPlan.evaluationYears,
		);
	const analysisRows = dates.map((date): FinancialIndependenceRow => {
		const row = latestRowAtOrBefore(path.rows, date);
		const annualDirectIncome = realizedCashflowBetween(
			projectedRows,
			cashflowIds,
			date,
			addYearsClamped(date, 1),
		);
		let selectedAssetBalance = 0;
		let annualWithdrawalCapacity = 0;
		for (const [accountId, rate] of assetRates) {
			const balance = Math.max(0, row ? balanceAt(row, accountId) : 0);
			selectedAssetBalance += balance;
			annualWithdrawalCapacity += balance * rate;
		}
		const annualExpenseTarget = expenseAt(
			normalizedPlan,
			path.projectionStartDate,
			date,
		);
		const totalAnnualCapacity = annualDirectIncome + annualWithdrawalCapacity;
		const coverageRatio =
			annualExpenseTarget > 0 ? totalAnnualCapacity / annualExpenseTarget : 0;
		const netWorth = row?.netWorth ?? 0;
		const minimumNetWorthMet = netWorth >= normalizedPlan.minimumNetWorth;
		const isCovered = annualExpenseTarget > 0 && coverageRatio >= 1;
		return {
			date,
			netWorth,
			minimumNetWorth: normalizedPlan.minimumNetWorth,
			minimumNetWorthMet,
			annualDirectIncome,
			selectedAssetBalance,
			annualWithdrawalCapacity,
			totalAnnualCapacity,
			annualExpenseTarget,
			coverageRatio,
			isCovered,
			isEligible: minimumNetWorthMet && isCovered,
		};
	});
	const runOutcomes = analysisRows.map((candidate) =>
		evaluateCycle({
			path,
			plan: normalizedPlan,
			candidate,
			stochasticRates,
		}),
	);

	return {
		rows: analysisRows,
		runOutcomes,
		milestones: {
			firstCoverageDate:
				analysisRows.find((row) => row.isCovered)?.date ?? null,
			firstSelfSustainingDate:
				runOutcomes.find((outcome) => outcome.cycleEstablished)
					?.candidateDate ?? null,
		},
	};
}
