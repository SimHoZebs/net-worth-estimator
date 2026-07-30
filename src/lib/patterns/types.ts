import type {
	Account,
	FinancialIndependenceExpenseBasis,
	FinancialIndependencePrincipalPolicy,
	Posting,
} from "@/lib/projection";

export interface IncomeTemplateInput {
	label: string;
	grossMonthlyIncome: number;
	taxRate: number;
	k401ContributionRate: number;
	k401EmployerMatchRate: number;
	k401AnnualCap: number;
	autoInvestRate: number;
	startDate: string;
}

export interface FinancialIndependenceTemplateInput {
	minimumNetWorth: number;
	annualExpenseTarget: number;
	annualExpenseTargetBasis: FinancialIndependenceExpenseBasis;
	annualExpenseGrowthRate: number;
	withdrawalRate: number;
	evaluationYears: number;
	requiredConfidence: number;
	directIncomePostingIds: string[];
	assets: Array<{
		accountId: string;
		withdrawalRateOverride?: number;
	}>;
	continuingPostingIds: string[];
	principalPolicy: FinancialIndependencePrincipalPolicy;
}

export interface TemplateOutput {
	accounts: Account[];
	postings: Posting[];
}

export type TemplateGenerationResult =
	| { ok: true; output: TemplateOutput }
	| { ok: false; error: string };
