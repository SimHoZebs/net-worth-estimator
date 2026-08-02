import type { FinancialModelDocument } from "./types/model";
import type { ModelValidationIssue } from "./types/validation";

export interface FinancialModelParseResult {
	document: FinancialModelDocument | null;
	issues: ModelValidationIssue[];
}

export class FinancialModelValidationError extends Error {
	readonly result: FinancialModelParseResult;

	constructor(result: FinancialModelParseResult) {
		const details = result.issues
			.filter((issue) => issue.severity === "error")
			.map((issue) => issue.message)
			.join(" ");
		super(
			details
				? `The financial model contains validation errors: ${details}`
				: "The financial model contains validation errors.",
		);
		this.name = "FinancialModelValidationError";
		this.result = result;
	}
}

export interface DataSourceAction<TArgs extends unknown[] = []> {
	readonly label: string;
	readonly description: string;
	run(...args: TArgs): Promise<FinancialModelParseResult>;
}

export interface DataSource {
	readonly sourceType: string;
	readonly label: string;
	readonly description: string;
	loadDocument(): Promise<FinancialModelParseResult>;
	readonly save?: DataSourceAction<[FinancialModelDocument]>;
	readonly reset?: DataSourceAction;
}
