import type { IncomeDataSnapshot } from "./types/income";
import type { ModelValidationIssue } from "./types/validation";

export interface IncomeDataSource {
	readonly sourceType: string;
	readonly label: string;
	readonly description: string;
	load(): Promise<IncomeDataLoadResult>;
}

export interface IncomeDataLoadResult {
	data: IncomeDataSnapshot | null;
	issues: ModelValidationIssue[];
}
