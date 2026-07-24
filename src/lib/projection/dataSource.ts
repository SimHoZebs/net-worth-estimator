import type { FinancialModelDocument } from "./types/model";
import type { ModelValidationIssue } from "./types/validation";

export interface FinancialModelParseResult {
	document: FinancialModelDocument | null;
	issues: ModelValidationIssue[];
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

/**
 * @deprecated Use FinancialModelParseResult. Remove after all downstream
 * consumers read the canonical document envelope.
 */
export interface ScenarioParseResult {
	pack: FinancialModelDocument | null;
	issues: ModelValidationIssue[];
}

/**
 * @deprecated Use DataSource.loadDocument. Remove after all concrete factory
 * consumers have migrated from loadPack.
 */
export interface LegacyScenarioDataSource {
	loadPack(): Promise<ScenarioParseResult>;
}

/** @deprecated Remove with ScenarioParseResult. */
export function toScenarioParseResult(
	result: FinancialModelParseResult,
): ScenarioParseResult {
	return { pack: result.document, issues: result.issues };
}
