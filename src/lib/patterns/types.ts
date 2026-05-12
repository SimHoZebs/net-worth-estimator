import type { Account, Checkpoint, Posting } from "@/lib/projection";

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

export interface TemplateOutput {
	accounts: Account[];
	postings: Posting[];
	checkpoints: Checkpoint[];
}

export type TemplateGenerationResult =
	| { ok: true; output: TemplateOutput }
	| { ok: false; error: string };
