import type { EvaluationDiagnostic } from "../api/contracts.ts";
import { horizonDate } from "./result.ts";

export type PrincipalPolicy =
	| "allow-drawdown"
	| "preserve-nominal-principal"
	| "preserve-real-principal";

export interface IndependenceWithdrawalFailure {
	date: string;
	requested: number | null;
	realized: number | null;
	shortfall: number | null;
	constraints: string[];
	accountIds: string[];
}

export interface IndependenceOutcome {
	kind: "summary" | "ineligible" | "evaluated";
	attempted: boolean;
	insufficientCapacity: boolean;
	cycleEstablished: boolean | null;
	expensesCovered: boolean | null;
	principalPreserved: boolean | null;
	firstShortfallDate: string | null;
	firstShortfall: IndependenceWithdrawalFailure | null;
	startingBalance: number | null;
	endingBalance: number | null;
	endingRealBalance: number | null;
	trajectory: { date: string; balance: number }[];
}

export interface IndependenceCandidate {
	date: string;
	netWorth: number | null;
	minimumNetWorth: number | null;
	minimumNetWorthMet: boolean | null;
	annualIncome: number | null;
	annualWithdrawals: number | null;
	annualCapacity: number | null;
	annualSpending: number | null;
	coverage: number | null;
	covered: boolean | null;
	assets: {
		accountId: string;
		capacity: number;
		balance: number;
		rate: number;
	}[];
	outcome: IndependenceOutcome | null;
}

export interface FinancialIndependenceAnalysis {
	available: boolean;
	startDate: string;
	endDate: string | null;
	evaluationYears: number | null;
	principalPolicy: PrincipalPolicy | null;
	requiredConfidence: number | null;
	expenseBasis: string | null;
	candidates: IndependenceCandidate[];
	firstCoverageDate: string | null;
	firstSelfSustainingDate: string | null;
	defaultDate: string | null;
	diagnostics: EvaluationDiagnostic[];
	accountNames: Record<string, string>;
	incomeNames: string[];
	continuingNames: string[];
}

export interface FinancialIndependenceRange {
	probability: number | null;
	date: string | null;
	dateProbability: number | null;
	count: number;
}

/** Display the engine's annual funding amounts without rerunning the FI test. */
export function independenceFunding(candidate: IndependenceCandidate) {
	const {
		annualIncome: income,
		annualWithdrawals: withdrawals,
		annualCapacity: capacity,
		annualSpending: spending,
		coverage,
	} = candidate;
	if (
		income === null ||
		withdrawals === null ||
		capacity === null ||
		spending === null ||
		spending <= 0 ||
		coverage === null
	)
		return null;
	return {
		income,
		withdrawals,
		capacity,
		spending,
		coverage,
		gap: Math.max(0, spending - capacity),
		surplus: Math.max(0, capacity - spending),
	};
}

/** Compare the configured test window with the actual projection horizon. */
export function independenceHorizon(analysis: FinancialIndependenceAnalysis) {
	const availableYears = analysis.endDate
		? Number(analysis.endDate.slice(0, 4)) -
			Number(analysis.startDate.slice(0, 4))
		: null;
	const requiredYears = analysis.evaluationYears;
	const tooShort =
		analysis.available &&
		!analysis.candidates.length &&
		analysis.endDate !== null &&
		requiredYears !== null &&
		horizonDate({ start: analysis.startDate, years: requiredYears }) >
			analysis.endDate;
	return { availableYears, requiredYears, tooShort };
}
