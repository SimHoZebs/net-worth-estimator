import { runReactiveBehavior } from "../behavior/runtime";
import { getWithdrawableAmount } from "../simulation/accounts";
import {
	type AccountMovementResult,
	addOccurrences,
	type DatedPostingOccurrence,
} from "../simulation/postings";
import {
	createTransitionRuntime,
	type SimulationTransitionRuntime,
} from "../simulation/transitions";
import type {
	Account,
	AccountMovementConstraint,
	AccountMovementConstraintType,
	FinancialIndependenceAnalysis,
	FinancialIndependencePlan,
	FinancialIndependenceRow,
	FinancialIndependenceRunOutcome,
	FinancialIndependenceWithdrawalSummary,
	IsoDate,
	MovementEvent,
	ProjectionPath,
	ProjectionRow,
} from "../types/model";
import type { MonteCarloSample, SimulationState } from "../types/simulation";
import type { PercentileBands } from "../types/stochastic";
import {
	addMonthsClamped,
	addYearsClamped,
	compareIsoDates,
	daysBetween,
} from "../utils/date";
import { computePercentiles } from "../utils/stochastic";
import { classifyMovementConstraints } from "./movementConstraints";
import type { EvaluationDefinition } from "./runtime";

const EPSILON = 0.01;

function movementUnfulfilledAmount(result: AccountMovementResult) {
	return Math.max(0, result.requestedAmount - result.realizedAmount);
}

interface WithdrawalAttempt {
	date: IsoDate;
	accountId: string | null;
	result: AccountMovementResult;
	bindingConstraints: AccountMovementConstraint[];
}

function constraintAccountIds(constraint: AccountMovementConstraint): string[] {
	switch (constraint.type) {
		case "source-unavailable":
		case "source-floor":
			return [constraint.accountId];
		case "destination-ceiling":
			return constraint.accountIds;
		case "action-limit":
			return [];
	}
}

function countConstraints(attempts: readonly WithdrawalAttempt[]) {
	const counts = new Map<AccountMovementConstraintType, number>();
	for (const attempt of attempts) {
		for (const constraint of attempt.bindingConstraints) {
			counts.set(constraint.type, (counts.get(constraint.type) ?? 0) + 1);
		}
	}
	return [...counts].map(([type, count]) => ({ type, count }));
}

function summarizeWithdrawals(
	attempts: readonly WithdrawalAttempt[],
): FinancialIndependenceWithdrawalSummary {
	const roundAmount = (amount: number) => Math.round(amount * 100) / 100;
	const requestedAmount = roundAmount(
		attempts.reduce((sum, attempt) => sum + attempt.result.requestedAmount, 0),
	);
	const realizedAmount = roundAmount(
		attempts.reduce((sum, attempt) => sum + attempt.result.realizedAmount, 0),
	);
	const shortfallAmount =
		requestedAmount - realizedAmount > EPSILON
			? roundAmount(requestedAmount - realizedAmount)
			: 0;
	const shortfallPeriods = new Map<IsoDate, WithdrawalAttempt[]>();
	for (const attempt of attempts) {
		if (movementUnfulfilledAmount(attempt.result) <= EPSILON) continue;
		const period = shortfallPeriods.get(attempt.date) ?? [];
		period.push(attempt);
		shortfallPeriods.set(attempt.date, period);
	}
	const shortfallDates = [...shortfallPeriods.keys()].sort(compareIsoDates);
	const relatedAccountIds = [
		...new Set(
			attempts.flatMap((attempt) => [
				...(attempt.accountId === null ? [] : [attempt.accountId]),
				...attempt.bindingConstraints.flatMap(constraintAccountIds),
			]),
		),
	];
	const accountIds = [
		...new Set(
			attempts.flatMap((attempt) =>
				attempt.accountId === null ? [] : [attempt.accountId],
			),
		),
	];
	const firstAttempts = attempts.filter(
		(attempt) => attempt.date === shortfallDates[0],
	);
	const firstRequested = roundAmount(
		firstAttempts.reduce(
			(sum, attempt) => sum + attempt.result.requestedAmount,
			0,
		),
	);
	const firstRealized = roundAmount(
		firstAttempts.reduce(
			(sum, attempt) => sum + attempt.result.realizedAmount,
			0,
		),
	);

	return {
		requestedAmount,
		realizedAmount,
		shortfallAmount,
		firstShortfallDate: shortfallDates[0] ?? null,
		lastShortfallDate: shortfallDates[shortfallDates.length - 1] ?? null,
		shortfallOccurrenceCount: shortfallDates.length,
		constraints: countConstraints(
			attempts.filter(
				(attempt) => movementUnfulfilledAmount(attempt.result) > EPSILON,
			),
		),
		relatedAccountIds,
		accounts: accountIds.map((accountId) => {
			const accountAttempts = attempts.filter(
				(attempt) => attempt.accountId === accountId,
			);
			const accountRequested = roundAmount(
				accountAttempts.reduce(
					(sum, attempt) => sum + attempt.result.requestedAmount,
					0,
				),
			);
			const accountRealized = roundAmount(
				accountAttempts.reduce(
					(sum, attempt) => sum + attempt.result.realizedAmount,
					0,
				),
			);
			const accountShortfall = accountRequested - accountRealized;
			return {
				accountId,
				requestedAmount: accountRequested,
				realizedAmount: accountRealized,
				shortfallAmount:
					accountShortfall > EPSILON ? roundAmount(accountShortfall) : 0,
				constraints: countConstraints(
					accountAttempts.filter(
						(attempt) => movementUnfulfilledAmount(attempt.result) > EPSILON,
					),
				),
			};
		}),
		firstShortfall:
			firstAttempts.length === 0
				? null
				: {
						date: shortfallDates[0]!,
						requestedAmount: firstRequested,
						realizedAmount: firstRealized,
						shortfallAmount:
							firstRequested - firstRealized > EPSILON
								? roundAmount(firstRequested - firstRealized)
								: 0,
						constraints: [
							...new Set(
								firstAttempts.flatMap((attempt) =>
									attempt.bindingConstraints.map(
										(constraint) => constraint.type,
									),
								),
							),
						],
						relatedAccountIds: [
							...new Set(
								firstAttempts.flatMap((attempt) => [
									...(attempt.accountId === null ? [] : [attempt.accountId]),
									...attempt.bindingConstraints.flatMap(constraintAccountIds),
								]),
							),
						],
					},
	};
}

export const DEFAULT_FI_PLAN: FinancialIndependencePlan = {
	minimumNetWorth: 0,
	annualExpenseTarget: 0,
	annualExpenseTargetBasis: "fi-date-dollars",
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
	candidateWithdrawalDiagnostics: FinancialIndependenceCandidateWithdrawalDiagnostic[];
}

export interface FinancialIndependenceCandidateWithdrawalDiagnostic {
	candidateDate: IsoDate;
	totalRunCount: number;
	diagnosticRunCount: number;
	shortfallRunCount: number;
	shortfallProbability: number;
	medianFirstShortfallDate: IsoDate | null;
	shortfallAmountPercentiles: PercentileBands;
}

interface FinancialIndependenceAccumulator {
	candidateDates: IsoDate[];
	coverageRatios: number[][];
	cycleSuccessCounts: number[];
	diagnosticRunCounts: number[];
	shortfallRunCounts: number[];
	firstShortfallDates: IsoDate[][];
	shortfallAmounts: number[][];
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
	const sources = plan.sources.map((source) => {
		if (source.type === "cashflow") {
			return {
				type: "cashflow" as const,
				postingId: source.postingId,
				included: source.included,
			};
		}
		return source.withdrawalRateOverride === undefined
			? source
			: {
					...source,
					withdrawalRateOverride: Math.min(
						1,
						finiteNonNegative(source.withdrawalRateOverride),
					),
				};
	});
	const spendableIncomeIds = new Set(
		sources.flatMap((source) =>
			source.type === "cashflow" && source.included ? [source.postingId] : [],
		),
	);
	return {
		...plan,
		minimumNetWorth: finiteNonNegative(plan.minimumNetWorth),
		annualExpenseTarget: finiteNonNegative(plan.annualExpenseTarget),
		annualExpenseTargetBasis:
			plan.annualExpenseTargetBasis === "fi-date-dollars"
				? "fi-date-dollars"
				: "projection-start-purchasing-power",
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
		sources,
		continuingPostingIds: [...new Set(plan.continuingPostingIds)].filter(
			(postingId) => !spendableIncomeIds.has(postingId),
		),
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
		path.effectiveDocument.postings.map((posting) => [
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
	baselineDate: IsoDate,
	date: IsoDate,
) {
	const years = Math.max(0, daysBetween(baselineDate, date) / 365.2425);
	return plan.annualExpenseTarget * (1 + plan.annualExpenseGrowthRate) ** years;
}

function expenseBaselineDate(
	plan: FinancialIndependencePlan,
	projectionStartDate: IsoDate,
	candidateDate: IsoDate,
) {
	return plan.annualExpenseTargetBasis === "projection-start-purchasing-power"
		? projectionStartDate
		: candidateDate;
}

function realizedCashflowBetween(
	events: readonly MovementEvent[],
	cashflowIds: ReadonlySet<string>,
	startDate: IsoDate,
	endDate: IsoDate,
) {
	let total = 0;
	for (const event of events) {
		if (event.date <= startDate) continue;
		if (event.date > endDate) break;
		if (cashflowIds.has(event.origin.postingId)) total += event.realizedAmount;
	}
	return total;
}

function initializeBranchSimulationState(
	balances: Record<string, number>,
	events: readonly MovementEvent[],
	candidateDate: IsoDate,
	continuingPostingIds: ReadonlySet<string>,
): SimulationState {
	const latestRealizedPostingAmounts = new Map<string, number>();
	const realizedPostingAmountsByYear = new Map<string, Map<string, number>>();
	for (const event of events) {
		if (event.date > candidateDate) break;
		const postingId = event.origin.postingId;
		latestRealizedPostingAmounts.set(postingId, event.realizedAmount);
		if (!continuingPostingIds.has(postingId)) continue;
		const year = event.date.slice(0, 4);
		const amountsByYear =
			realizedPostingAmountsByYear.get(postingId) ?? new Map<string, number>();
		amountsByYear.set(
			year,
			(amountsByYear.get(year) ?? 0) + event.realizedAmount,
		);
		realizedPostingAmountsByYear.set(postingId, amountsByYear);
	}
	return {
		balances,
		latestRealizedPostingAmounts,
		realizedPostingAmountsByYear,
	};
}

function applyBranchPostingEvents({
	events,
	baseRealizedByDateAndPosting,
	dispositions,
	transitions,
}: {
	events: readonly (readonly [IsoDate, readonly DatedPostingOccurrence[]])[];
	baseRealizedByDateAndPosting: ReadonlyMap<string, number>;
	dispositions: ReadonlyMap<string, FiPostingDisposition>;
	transitions: SimulationTransitionRuntime;
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
					baseRealizedByDateAndPosting.get(`${date}:${posting.id}`) ?? 0;
				transitions.observePosting(posting.id, realizedAmount);
				observedDirectIncome += realizedAmount;
				continue;
			}
			transitions.executePosting(occurrence, date);
		}
	}
	return observedDirectIncome;
}

function evaluateCycle({
	path,
	plan,
	candidate,
	monteCarloSample,
	captureBalanceTrajectory = false,
}: {
	path: ProjectionPath;
	plan: FinancialIndependencePlan;
	candidate: FinancialIndependenceRow;
	monteCarloSample?: MonteCarloSample;
	captureBalanceTrajectory?: boolean;
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
			withdrawals: summarizeWithdrawals([]),
			balanceTrajectory: [],
		};
	}

	const assetRates = selectedAssetRates(plan);
	const expenseBaseline = expenseBaselineDate(
		plan,
		path.projectionStartDate,
		candidate.date,
	);
	const cashflowIds = selectedCashflowIds(plan);
	const accountsById = new Map(
		path.effectiveDocument.accounts.map((account) => [account.id, account]),
	);
	const candidateBalances = balancesAt(
		candidateRow,
		path.effectiveDocument.accounts,
	);
	const startingSelectedAssetBalance = [...assetRates.keys()].reduce(
		(sum, accountId) => sum + Math.max(0, candidateBalances[accountId] ?? 0),
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
	const branchPostings = path.effectiveDocument.postings.filter(
		(posting) => posting.enabled && dispositions.get(posting.id) !== "disabled",
	);
	const baseRealizedByDateAndPosting = new Map(
		path.movementEvents.map(
			(event) =>
				[
					`${event.date}:${event.origin.postingId}`,
					event.realizedAmount,
				] as const,
		),
	);
	const transitions = createTransitionRuntime({
		model: {
			accounts: path.effectiveDocument.accounts,
			postings: branchPostings,
		},
		initialState: initializeBranchSimulationState(
			candidateBalances,
			path.movementEvents,
			candidate.date,
			continuingIds,
		),
		projectionStartDate: path.projectionStartDate,
		monteCarloSample,
	});
	const { balances } = transitions.state;
	const selectedAccountIds = [...assetRates.keys()];
	const balanceTrajectoryRow = (date: IsoDate) => ({
		date,
		accounts: selectedAccountIds.map((accountId) => ({
			accountId,
			balance: balances[accountId] ?? 0,
		})),
	});
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
			withdrawalAttempts: [] as WithdrawalAttempt[],
			remainingWithdrawalByAccount: new Map<string, number>(),
			balanceTrajectory: captureBalanceTrajectory
				? [balanceTrajectoryRow(candidate.date)]
				: [],
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
				baseRealizedByDateAndPosting,
				dispositions,
				transitions,
			});
			let remainingExpense = Math.max(
				0,
				expenseAt(plan, expenseBaseline, period.startDate) / 12 - directIncome,
			);
			const capacities = [...assetRates.keys()].map((accountId) => {
				const accountLimit = getWithdrawableAmount(
					balances,
					accountsById,
					accountId,
				);
				const actionLimit = Math.min(
					Math.max(0, balances[accountId] ?? 0),
					state.remainingWithdrawalByAccount.get(accountId) ?? 0,
				);
				return {
					accountId,
					actionLimit,
					capacity: Math.min(accountLimit, actionLimit),
				};
			});
			const totalCapacity = capacities.reduce(
				(sum, item) => sum + item.capacity,
				0,
			);
			const requestedExpense = remainingExpense;
			let allocatedRequest = 0;
			for (const [
				index,
				{ accountId, capacity, actionLimit },
			] of capacities.entries()) {
				const requestedAmount =
					index === capacities.length - 1
						? requestedExpense - allocatedRequest
						: requestedExpense *
							(totalCapacity > 0
								? capacity / totalCapacity
								: 1 / capacities.length);
				allocatedRequest += requestedAmount;
				const action = {
					type: "replace-expense-withdrawal" as const,
					movement: {
						sourceAccountId: accountId,
						destinations: null,
						requestedAmount,
						limitRemaining: actionLimit,
					},
				};
				const balancesBefore = { ...balances };
				const movement = transitions.executeGeneratedMovement(
					action.movement,
				).result;
				state.withdrawalAttempts.push({
					date: period.startDate,
					accountId,
					result: movement,
					bindingConstraints: classifyMovementConstraints({
						sourceAccountId: action.movement.sourceAccountId,
						destinations: action.movement.destinations,
						requestedAmount: action.movement.requestedAmount,
						realizedAmount: movement.realizedAmount,
						balancesBefore,
						accountsById,
						limitRemaining: action.movement.limitRemaining,
					}),
				});
				state.remainingWithdrawalByAccount.set(
					accountId,
					Math.max(
						0,
						(state.remainingWithdrawalByAccount.get(accountId) ?? 0) -
							movement.realizedAmount,
					),
				);
				remainingExpense -= movement.realizedAmount;
			}
			if (capacities.length === 0 && requestedExpense > EPSILON) {
				const movementAction = {
					sourceAccountId: null,
					destinations: null,
					requestedAmount: requestedExpense,
					limitRemaining: 0,
				};
				const balancesBefore = { ...balances };
				const movement =
					transitions.executeGeneratedMovement(movementAction).result;
				state.withdrawalAttempts.push({
					date: period.startDate,
					accountId: null,
					result: movement,
					bindingConstraints: classifyMovementConstraints({
						...movementAction,
						realizedAmount: movement.realizedAmount,
						balancesBefore,
						accountsById,
					}),
				});
			}
			if (remainingExpense > EPSILON) state.hadWithdrawalShortfall = true;
			if (captureBalanceTrajectory) {
				state.balanceTrajectory.push(balanceTrajectoryRow(period.endDate));
			}
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
				withdrawals: summarizeWithdrawals(state.withdrawalAttempts),
				balanceTrajectory: state.balanceTrajectory,
			};
		},
	});
}

export function selectFinancialIndependenceOutcomeIndex(
	outcomes: readonly FinancialIndependenceRunOutcome[],
) {
	const successfulIndex = outcomes.findIndex(
		(outcome) => outcome.cycleEstablished,
	);
	if (successfulIndex >= 0) return successfulIndex;
	for (let index = outcomes.length - 1; index >= 0; index--) {
		if (outcomes[index]?.status === "evaluated") return index;
	}
	return outcomes.length - 1;
}

export function evaluateFinancialIndependence({
	path,
	plan,
	monteCarloSample,
	candidateDates,
}: {
	path: ProjectionPath;
	plan: FinancialIndependencePlan;
	monteCarloSample?: MonteCarloSample;
	candidateDates?: readonly IsoDate[];
}): FinancialIndependenceAnalysis {
	const normalizedPlan = normalizeFinancialIndependencePlan(plan);
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
			path.movementEvents,
			cashflowIds,
			date,
			addYearsClamped(date, 1),
		);
		const assetContributions = [...assetRates].map(([accountId, rate]) => {
			const balance = Math.max(0, row ? balanceAt(row, accountId) : 0);
			return {
				accountId,
				balance,
				withdrawalRate: rate,
				annualWithdrawalCapacity: balance * rate,
			};
		});
		const selectedAssetBalance = assetContributions.reduce(
			(sum, contribution) => sum + contribution.balance,
			0,
		);
		const annualWithdrawalCapacity = assetContributions.reduce(
			(sum, contribution) => sum + contribution.annualWithdrawalCapacity,
			0,
		);
		const annualExpenseTarget = expenseAt(
			normalizedPlan,
			expenseBaselineDate(normalizedPlan, path.projectionStartDate, date),
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
			assetContributions,
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
			monteCarloSample,
		}),
	);
	if (monteCarloSample === undefined) {
		const selectedIndex = selectFinancialIndependenceOutcomeIndex(runOutcomes);
		const candidate = analysisRows[selectedIndex];
		if (candidate && runOutcomes[selectedIndex]?.status === "evaluated") {
			runOutcomes[selectedIndex] = evaluateCycle({
				path,
				plan: normalizedPlan,
				candidate,
				captureBalanceTrajectory: true,
			});
		}
	}

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
		!config.sources.every((source) => {
			if (typeof source !== "object" || source === null) return false;
			if (!("type" in source) || !("included" in source)) return false;
			if (typeof source.included !== "boolean") return false;

			if (source.type === "cashflow") {
				return (
					Object.keys(source).every((key) =>
						["type", "postingId", "included"].includes(key),
					) &&
					"postingId" in source &&
					typeof source.postingId === "string"
				);
			}
			return (
				source.type === "asset" &&
				Object.keys(source).every((key) =>
					["type", "accountId", "included", "withdrawalRateOverride"].includes(
						key,
					),
				) &&
				"accountId" in source &&
				typeof source.accountId === "string" &&
				(!("withdrawalRateOverride" in source) ||
					(typeof source.withdrawalRateOverride === "number" &&
						Number.isFinite(source.withdrawalRateOverride)))
			);
		}) ||
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
		).includes(config.principalPolicy) ||
		("annualExpenseTargetBasis" in config &&
			!(
				["projection-start-purchasing-power", "fi-date-dollars"] as unknown[]
			).includes(config.annualExpenseTargetBasis))
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
		path.effectiveDocument.accounts.map((account) => account.id),
	);
	const postingIds = new Set(
		path.effectiveDocument.postings.map((posting) => posting.id),
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
	type: "financialIndependence",
	label: "Financial independence",
	validateConfig: validateFinancialIndependencePlan,
	diagnoseConfig({ path }, config) {
		const accountIds = new Set(
			path.effectiveDocument.accounts.map((account) => account.id),
		);
		const postingIds = new Set(
			path.effectiveDocument.postings.map((posting) => posting.id),
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
	evaluatePath({ path, monteCarloSample }, config) {
		return evaluateFinancialIndependence({
			path,
			plan: availableFinancialIndependencePlan(path, config),
			monteCarloSample,
		});
	},
	createAccumulator(config, deterministicResult) {
		const candidateDates = deterministicResult.rows.map((row) => row.date);
		return {
			candidateDates,
			coverageRatios: candidateDates.map(() => []),
			cycleSuccessCounts: candidateDates.map(() => 0),
			diagnosticRunCounts: candidateDates.map(() => 0),
			shortfallRunCounts: candidateDates.map(() => 0),
			firstShortfallDates: candidateDates.map(() => []),
			shortfallAmounts: candidateDates.map(() => []),
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
			const outcome = pathResult.runOutcomes[index];
			if (outcome?.status === "evaluated") {
				accumulator.diagnosticRunCounts[index]++;
				accumulator.shortfallAmounts[index]?.push(
					outcome.withdrawals.shortfallAmount,
				);
				if (outcome.withdrawals.firstShortfallDate !== null) {
					accumulator.shortfallRunCounts[index]++;
					accumulator.firstShortfallDates[index]?.push(
						outcome.withdrawals.firstShortfallDate,
					);
				}
			}
			if (outcome?.cycleEstablished) {
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
			candidateWithdrawalDiagnostics: accumulator.candidateDates.map(
				(candidateDate, index) => {
					const diagnosticRunCount =
						accumulator.diagnosticRunCounts[index] ?? 0;
					const shortfallRunCount = accumulator.shortfallRunCounts[index] ?? 0;
					const firstDates = [
						...(accumulator.firstShortfallDates[index] ?? []),
					].sort(compareIsoDates);
					return {
						candidateDate,
						totalRunCount: accumulator.runCount,
						diagnosticRunCount,
						shortfallRunCount,
						shortfallProbability:
							diagnosticRunCount > 0
								? shortfallRunCount / diagnosticRunCount
								: 0,
						medianFirstShortfallDate:
							firstDates.length > 0
								? (firstDates[Math.floor((firstDates.length - 1) / 2)] ?? null)
								: null,
						shortfallAmountPercentiles: computePercentiles(
							accumulator.shortfallAmounts[index] ?? [],
						),
					};
				},
			),
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
