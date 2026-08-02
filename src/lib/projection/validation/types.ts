import type { IncomeDataSnapshot } from "../types/income";
import type { EvaluationType } from "../types/model";
import type { ModelPath } from "../types/validation";

export interface ValidationPaths {
	account(index: number, field?: string): ModelPath;
	posting(index: number, field?: string): ModelPath;
	postings(): ModelPath;
	evaluation(type: EvaluationType): ModelPath;
}

export interface FinancialModelValidationOptions {
	incomeData?: IncomeDataSnapshot;
	paths?: ValidationPaths;
}
