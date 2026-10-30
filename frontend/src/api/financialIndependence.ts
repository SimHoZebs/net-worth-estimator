import type {
	EvaluationResultEnvelope,
	FinancialModel,
	FinancialIndependenceEvaluation,
} from "./contracts.ts";
import type {
	FinancialIndependenceAnalysis,
	FinancialIndependenceRange,
	IndependenceCandidate,
	IndependenceOutcome,
} from "../domain/financialIndependence.ts";
import { dateLabel, isIsoDate, money, percent } from "../domain/format.ts";
import { finite, isRecord, parseUnion, stringValue } from "../domain/guards.ts";
import type { OtherEvaluation } from "../domain/result.ts";

const record = (value: unknown): Record<string, unknown> =>
	isRecord(value) ? value : {};
const records = (value: unknown): Record<string, unknown>[] =>
	Array.isArray(value) ? value.filter(isRecord) : [];
const strings = (value: unknown): string[] =>
	Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
const boolean = (value: unknown): boolean | null =>
	typeof value === "boolean" ? value : null;
const date = (value: unknown): string | null =>
	typeof value === "string" && isIsoDate(value) ? value : null;

function mapOutcome(raw: Record<string, unknown>): IndependenceOutcome | null {
	const kind = parseUnion(raw.status, [
		"summary",
		"ineligible",
		"evaluated",
	] as const);
	if (!kind) return null;
	const withdrawals = record(raw.withdrawals);
	const first = record(withdrawals.firstShortfall);
	const firstDate = date(first.date);
	const trajectory = records(raw.balanceTrajectory).flatMap((row) => {
		const at = date(row.date);
		const balances = records(row.accounts).map((account) =>
			finite(account.balance),
		);
		return at &&
			balances.length &&
			balances.every((balance) => balance !== null)
			? [
					{
						date: at,
						balance: balances.reduce<number>(
							(sum, balance) => sum + (balance ?? 0),
							0,
						),
					},
				]
			: [];
	});
	const attempted =
		kind === "summary"
			? raw.simulationAttempted === true
			: kind === "evaluated" || trajectory.length > 0;
	const firstShortfallDate =
		date(raw.firstShortfallDate) ??
		date(withdrawals.firstShortfallDate) ??
		firstDate;
	// Summary branches stop at the first shortfall. Without one, a completed
	// attempted branch reports payment success and its principal-policy verdict.
	const completedSummary =
		kind === "summary" && attempted && Object.hasOwn(raw, "firstShortfallDate");
	const cycleEstablished = boolean(raw.cycleEstablished);
	return {
		kind,
		attempted,
		insufficientCapacity:
			kind === "summary" &&
			raw.simulationAttempted === false &&
			raw.minimumNetWorthMet === true &&
			raw.initialCoverageMet === true,
		cycleEstablished,
		expensesCovered:
			kind === "summary"
				? completedSummary
					? firstShortfallDate === null
					: null
				: boolean(raw.expensesFullyCovered),
		principalPreserved:
			kind === "summary"
				? completedSummary && !firstShortfallDate
					? cycleEstablished
					: null
				: boolean(raw.principalReplenished),
		firstShortfallDate,
		firstShortfall: firstDate
			? {
					date: firstDate,
					requested: finite(first.requestedAmount),
					realized: finite(first.realizedAmount),
					shortfall: finite(first.shortfallAmount),
					constraints: strings(first.constraints),
					accountIds: strings(first.relatedAccountIds),
				}
			: null,
		startingBalance: finite(raw.startingSelectedAssetBalance),
		endingBalance: finite(raw.endingSelectedAssetBalance),
		endingRealBalance: finite(raw.endingRealSelectedAssetBalance),
		trajectory,
	};
}

function mapCandidate(
	raw: Record<string, unknown>,
	outcome: IndependenceOutcome | null,
): IndependenceCandidate | null {
	const at = date(raw.date);
	if (!at) return null;
	return {
		date: at,
		netWorth: finite(raw.netWorth),
		minimumNetWorth: finite(raw.minimumNetWorth),
		minimumNetWorthMet: boolean(raw.minimumNetWorthMet),
		annualIncome: finite(raw.annualDirectIncome),
		annualWithdrawals: finite(raw.annualWithdrawalCapacity),
		annualCapacity: finite(raw.totalAnnualCapacity),
		annualSpending: finite(raw.annualExpenseTarget),
		coverage: finite(raw.coverageRatio),
		covered: boolean(raw.isCovered),
		outcome,
		assets: records(raw.assetContributions).flatMap((asset) => {
			const accountId = stringValue(asset.accountId);
			const capacity = finite(asset.annualWithdrawalCapacity);
			const balance = finite(asset.balance);
			const rate = finite(asset.withdrawalRate);
			return accountId && capacity !== null && balance !== null && rate !== null
				? [{ accountId, capacity, balance, rate }]
				: [];
		}),
	};
}

function mapAnalysis(
	evaluation: FinancialIndependenceEvaluation,
	envelope: EvaluationResultEnvelope | undefined,
	model: FinancialModel | null,
	startDate: string,
	endDate: string | null,
): FinancialIndependenceAnalysis | null {
	if (!envelope) return null;
	const available = isRecord(envelope.deterministic);
	const raw = record(envelope.deterministic);
	const config = record(evaluation.config);
	const outcomes = new Map(
		records(raw.runOutcomes).map((item) => [
			date(item.candidateDate),
			mapOutcome(item),
		]),
	);
	const candidates = records(raw.rows).flatMap((row) => {
		const candidate = mapCandidate(row, outcomes.get(date(row.date)) ?? null);
		return candidate ? [candidate] : [];
	});
	const milestones = record(raw.milestones);
	const firstSelfSustainingDate = date(milestones.firstSelfSustainingDate);
	const detailed = candidates.find(
		(candidate) =>
			(candidate.outcome?.trajectory.length ?? 0) > 0 ||
			candidate.outcome?.kind === "evaluated",
	);
	const transactions = new Map(
		[
			...(model?.postings ?? []),
			...(model?.recurrenceRules ?? []),
			...(model?.plannedPurchases ?? []),
		].map((item) => [item.id, item.name]),
	);
	const years = finite(config.evaluationYears);
	const confidence = finite(config.requiredConfidence);
	return {
		available,
		startDate,
		endDate,
		evaluationYears:
			years !== null && years >= 1 && Number.isInteger(years) ? years : null,
		principalPolicy: parseUnion(config.principalPolicy, [
			"allow-drawdown",
			"preserve-nominal-principal",
			"preserve-real-principal",
		] as const),
		requiredConfidence:
			confidence !== null && confidence >= 0.01 && confidence <= 1
				? confidence
				: null,
		expenseBasis: stringValue(config.annualExpenseTargetBasis),
		candidates,
		firstSelfSustainingDate,
		firstCoverageDate: date(milestones.firstCoverageDate),
		defaultDate:
			detailed?.date ??
			firstSelfSustainingDate ??
			candidates.at(-1)?.date ??
			null,
		diagnostics: envelope.diagnostics ?? [],
		accountNames: Object.fromEntries(
			(model?.accounts ?? []).map((account) => [account.id, account.name]),
		),
		incomeNames: records(config.sources)
			.filter(
				(source) => source.included === true && source.type === "cashflow",
			)
			.map(
				(source) =>
					transactions.get(String(source.postingId)) ??
					String(source.postingId),
			),
		continuingNames: strings(config.continuingPostingIds).map(
			(id) => transactions.get(id) ?? id,
		),
	};
}

/** Preserve the existing summary contract while retaining evidence for the visual. */
export function financialIndependenceEvaluation(
	evaluation: FinancialIndependenceEvaluation,
	envelope: EvaluationResultEnvelope | undefined,
	model: FinancialModel | null,
	startDate: string,
	endDate: string | null,
): OtherEvaluation {
	const config = record(evaluation.config);
	const raw = record(envelope?.deterministic);
	const milestones = record(raw.milestones);
	const expenseTarget = finite(config.annualExpenseTarget);
	const evaluationYears =
		Math.trunc(finite(config.evaluationYears) ?? 0) || null;
	const sustaining = date(milestones.firstSelfSustainingDate);
	const coverage = date(milestones.firstCoverageDate);
	const rows = records(raw.rows);
	const first = rows[0];
	const firstExpenseTarget =
		finite(first?.annualExpenseTarget) ?? expenseTarget;
	const coveredOutcome = records(raw.runOutcomes).find(
		(outcome) => outcome.candidateDate === coverage,
	);
	const shortfallDate = date(coveredOutcome?.firstShortfallDate);
	const hasProgress =
		!sustaining &&
		!coverage &&
		first &&
		firstExpenseTarget !== null &&
		firstExpenseTarget > 0;
	const fraction = Math.max(0, finite(first?.coverageRatio) ?? 0);
	return {
		id: evaluation.instanceId,
		name: evaluation.name || evaluation.instanceId,
		type: "financialIndependence",
		enabled: evaluation.enabled,
		status: envelope?.status ?? "indeterminate",
		goal:
			expenseTarget !== null && expenseTarget > 0
				? `${money(expenseTarget)}/yr spending`
				: null,
		outcomeDate: sustaining ?? coverage,
		outcomeText: sustaining
			? "Satisfied"
			: coverage
				? "Covered"
				: "Beyond this horizon",
		qualifier: sustaining
			? null
			: coverage
				? shortfallDate
					? `Shortfall from ${dateLabel(shortfallDate)}`
					: evaluationYears
						? `Not sustained over ${evaluationYears} years`
						: "Not sustained"
				: !first && evaluationYears
					? `No ${evaluationYears}-year window fits`
					: null,
		progress: hasProgress
			? {
					fraction,
					current: money(finite(first.totalAnnualCapacity) ?? 0),
					share: percent(fraction),
				}
			: null,
		financialIndependence: mapAnalysis(
			evaluation,
			envelope,
			model,
			startDate,
			endDate,
		),
	};
}

export function financialIndependenceRange(
	envelope: EvaluationResultEnvelope,
	count: number,
): FinancialIndependenceRange {
	const raw = record(envelope.probabilistic);
	const probability = (value: unknown) => {
		const number = finite(value);
		return number === null ? null : Math.max(0, Math.min(1, number));
	};
	return {
		probability: probability(raw.fiCycleSuccessProbability),
		date: date(raw.selfSustainingDate),
		dateProbability: probability(raw.selfSustainingProbability),
		count,
	};
}
