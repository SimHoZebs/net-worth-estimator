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
	projectionYearIndex,
} from "../utils/date";
import type { EvaluationDefinition } from "./runtime";

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

export const FINANCIAL_INDEPENDENCE_DEFINITION_ID = "financial-independence";

export interface FinancialIndependenceProbabilisticResult {
	fiCycleSuccessProbability: number;
	medianCoverageDate: IsoDate | null;
	selfSustainingDate: IsoDate | null;
	selfSustainingProbability: number | null;
}

interface FinancialIndependenceAccumulator {
	candidateDates: IsoDate[];
	coverageRatios: number[][];
	cycleSuccessCounts: number[];
	requiredConfidence: number;
	successfulRunCount: number;
	runCount: number;
}

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

type FiPostingDisposition =
	| "observe-base-path-realized-occurrence"
	| "replay-in-branch"
	| "disabled";

function classifyPostingDispositions(
	path: ProjectionPath,
	cashflowIds: ReadonlySet<string>,
	continuingIds: ReadonlySet<string>,
) {
	return new Map<string, FiPostingDisposition>(
		path.effectivePack.postings.map((posting) => [
			posting.id,
			cashflowIds.has(posting.id)
				? "observe-base-path-realized-occurrence"
				: continuingIds.has(posting.id)
					? "replay-in-branch"
					: "disabled",
		]),
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

function applyBranchPostingEvents({
	events,
	baseRowsByDate,
	dispositions,
	balances,
	accountsById,
	latestPostingAmounts,
	realizedByPostingAndYear,
	projectionStartDate,
	stochasticRates,
}: {
	events: readonly (readonly [IsoDate, readonly DatedPostingOccurrence[]])[];
	baseRowsByDate: ReadonlyMap<IsoDate, ProjectionRow>;
	dispositions: ReadonlyMap<string, FiPostingDisposition>;
	balances: Record<string, number>;
	accountsById: Map<string, Account>;
	latestPostingAmounts: Map<string, number>;
	realizedByPostingAndYear: Map<string, number>;
	projectionStartDate: IsoDate;
	stochasticRates?: ReadonlyMap<string, readonly number[]>;
}) {
	let observedDirectIncome = 0;
	for (const [date, occurrences] of events) {
		const sorted = [...occurrences].sort(
			(left, right) =>
				left.posting.priority - right.posting.priority ||
				left.index - right.index,
		);
		for (const occurrence of sorted) {
			const { posting } = occurrence;
			const disposition = dispositions.get(posting.id) ?? "disabled";
			if (disposition === "disabled") continue;
			if (disposition === "observe-base-path-realized-occurrence") {
				const realizedAmount =
					baseRowsByDate.get(date)?.realizedPostingAmountsById[posting.id] ?? 0;
				latestPostingAmounts.set(posting.id, realizedAmount);
				observedDirectIncome += realizedAmount;
				continue;
			}

			const yearIndex = projectionYearIndex(projectionStartDate, date);
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
	return observedDirectIncome;
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
	const dispositions = classifyPostingDispositions(
		path,
		cashflowIds,
		continuingIds,
	);
	const branchPostings = path.effectivePack.postings.filter(
		(posting) => posting.enabled && dispositions.get(posting.id) !== "disabled",
	);
	const baseRowsByDate = new Map(
		path.rows
			.filter((row) => !row.isHistorical)
			.map((row) => [row.date, row] as const),
	);
	const eventDates = new Map<IsoDate, DatedPostingOccurrence[]>();
	const cycleEnd = addYearsClamped(candidate.date, plan.evaluationYears);
	addOccurrences(branchPostings, eventDates, candidate.date, cycleEnd, false);
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

			const directIncome = applyBranchPostingEvents({
				events: eventsByPeriod[period.index],
				baseRowsByDate,
				dispositions,
				balances,
				accountsById,
				latestPostingAmounts: state.latestPostingAmounts,
				realizedByPostingAndYear: state.realizedByPostingAndYear,
				projectionStartDate: path.projectionStartDate,
				stochasticRates,
			});
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
					type: "replace-expense-withdrawal" as const,
					movement: {
						sourceAccountId: accountId,
						destinations: null,
						requestedAmount,
						limitRemaining: capacity,
					},
				};
				const realizedAmount = Math.min(
					Math.max(0, balances[accountId] ?? 0),
					resolveAccountMovementAmount(action.movement, balances, accountsById),
				);
				applyAccountMovement(
					action.movement,
					realizedAmount,
					balances,
					accountsById,
				);
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
	const requestedDates =
		candidateDates ??
		buildFinancialIndependenceCandidateDates(
			path.projectionStartDate,
			path.projectionEndDate,
			normalizedPlan.evaluationYears,
		);
	const dates = [...new Set(requestedDates)]
		.filter(
			(date) =>
				date >= path.projectionStartDate &&
				addYearsClamped(date, normalizedPlan.evaluationYears) <=
					path.projectionEndDate,
		)
		.sort(compareIsoDates);
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

export function validateFinancialIndependencePlan(
	config: unknown,
): FinancialIndependencePlan {
	if (
		typeof config !== "object" ||
		config === null ||
		!("sources" in config) ||
		!Array.isArray(config.sources) ||
		!config.sources.every(
			(source) =>
				typeof source === "object" &&
				source !== null &&
				"type" in source &&
				"included" in source &&
				typeof source.included === "boolean" &&
				((source.type === "asset" &&
					"accountId" in source &&
					typeof source.accountId === "string") ||
					(source.type === "cashflow" &&
						"postingId" in source &&
						typeof source.postingId === "string")),
		) ||
		!("continuingPostingIds" in config) ||
		!Array.isArray(config.continuingPostingIds) ||
		!config.continuingPostingIds.every((id) => typeof id === "string") ||
		!("principalPolicy" in config) ||
		!(
			[
				"allow-drawdown",
				"preserve-nominal-principal",
				"preserve-real-principal",
			] as unknown[]
		).includes(config.principalPolicy)
	) {
		throw new Error("Financial independence configuration is invalid.");
	}
	const numericKeys = [
		"minimumNetWorth",
		"annualExpenseTarget",
		"annualExpenseGrowthRate",
		"withdrawalRate",
		"evaluationYears",
		"requiredConfidence",
	] as const;
	const record = config as Record<string, unknown>;
	for (const key of numericKeys) {
		if (typeof record[key] !== "number" || !Number.isFinite(record[key])) {
			throw new Error(`Financial independence ${key} must be a finite number.`);
		}
	}
	return normalizeFinancialIndependencePlan(
		config as unknown as FinancialIndependencePlan,
	);
}

function median(values: readonly number[]) {
	if (values.length === 0) return 0;
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[middle] ?? 0);
}

function availableFinancialIndependencePlan(
	path: ProjectionPath,
	config: FinancialIndependencePlan,
) {
	const accountIds = new Set(
		path.effectivePack.accounts.map((account) => account.id),
	);
	const postingIds = new Set(
		path.effectivePack.postings.map((posting) => posting.id),
	);
	return {
		...config,
		sources: config.sources.filter((source) =>
			source.type === "asset"
				? accountIds.has(source.accountId)
				: postingIds.has(source.postingId),
		),
		continuingPostingIds: config.continuingPostingIds.filter((id) =>
			postingIds.has(id),
		),
	};
}

export const financialIndependenceEvaluation: EvaluationDefinition<
	FinancialIndependencePlan,
	FinancialIndependenceAnalysis,
	FinancialIndependenceAccumulator,
	FinancialIndependenceProbabilisticResult
> = {
	id: FINANCIAL_INDEPENDENCE_DEFINITION_ID,
	label: "Financial independence",
	validateConfig: validateFinancialIndependencePlan,
	diagnoseConfig({ path }, config) {
		const accountIds = new Set(
			path.effectivePack.accounts.map((account) => account.id),
		);
		const postingIds = new Set(
			path.effectivePack.postings.map((posting) => posting.id),
		);
		return config.sources.flatMap((source) => {
			if (!source.included) return [];
			const missing =
				source.type === "asset"
					? !accountIds.has(source.accountId)
					: !postingIds.has(source.postingId);
			if (!missing) return [];
			return [
				{
					code: "missing-financial-independence-source",
					severity: "warning" as const,
					message: "An enabled FI source is unavailable and was ignored.",
					...(source.type === "asset"
						? { relatedAccountIds: [source.accountId] }
						: { relatedPostingIds: [source.postingId] }),
				},
			];
		});
	},
	evaluatePath({ path, stochasticRates }, config) {
		return evaluateFinancialIndependence({
			path,
			plan: availableFinancialIndependencePlan(path, config),
			stochasticRates,
		});
	},
	createAccumulator(config, deterministicResult) {
		const candidateDates = deterministicResult.rows.map((row) => row.date);
		return {
			candidateDates,
			coverageRatios: candidateDates.map(() => []),
			cycleSuccessCounts: candidateDates.map(() => 0),
			requiredConfidence: config.requiredConfidence,
			successfulRunCount: 0,
			runCount: 0,
		};
	},
	accumulate(accumulator, pathResult) {
		if (pathResult.rows.length !== accumulator.candidateDates.length) {
			throw new Error(
				"FI evaluation returned an inconsistent candidate count.",
			);
		}
		let runSucceeded = false;
		pathResult.rows.forEach((row, index) => {
			if (row.date !== accumulator.candidateDates[index]) {
				throw new Error(
					"FI evaluation returned an inconsistent candidate schedule.",
				);
			}
			accumulator.coverageRatios[index]?.push(row.coverageRatio);
			if (pathResult.runOutcomes[index]?.cycleEstablished) {
				accumulator.cycleSuccessCounts[index]++;
				runSucceeded = true;
			}
		});
		accumulator.runCount++;
		if (runSucceeded) accumulator.successfulRunCount++;
	},
	finalize(accumulator) {
		let medianCoverageDate: IsoDate | null = null;
		let selfSustainingDate: IsoDate | null = null;
		let selfSustainingProbability: number | null = null;
		for (let index = 0; index < accumulator.candidateDates.length; index++) {
			if (
				medianCoverageDate === null &&
				median(accumulator.coverageRatios[index] ?? []) >= 1
			) {
				medianCoverageDate = accumulator.candidateDates[index] ?? null;
			}
			const probability =
				accumulator.runCount > 0
					? (accumulator.cycleSuccessCounts[index] ?? 0) / accumulator.runCount
					: 0;
			if (
				selfSustainingDate === null &&
				probability >= accumulator.requiredConfidence
			) {
				selfSustainingDate = accumulator.candidateDates[index] ?? null;
				selfSustainingProbability = probability;
			}
		}
		return {
			fiCycleSuccessProbability:
				accumulator.runCount > 0
					? accumulator.successfulRunCount / accumulator.runCount
					: 0,
			medianCoverageDate,
			selfSustainingDate,
			selfSustainingProbability,
		};
	},
	status(deterministic, probabilistic) {
		return probabilistic
			? probabilistic.selfSustainingDate
				? "satisfied"
				: "not-satisfied"
			: deterministic?.milestones.firstSelfSustainingDate
				? "satisfied"
				: "not-satisfied";
	},
};
