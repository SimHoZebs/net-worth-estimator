import type { ScenarioPack } from "./types/scenario";
import type { ScenarioValidationIssue } from "./types/validation";

export interface ScenarioParseResult {
	pack: ScenarioPack | null;
	issues: ScenarioValidationIssue[];
}

export interface DataSourceAction<TArgs extends unknown[] = []> {
	readonly label: string;
	readonly description: string;
	run(...args: TArgs): Promise<ScenarioParseResult>;
}

export interface DataSource {
	readonly sourceType: string;
	readonly label: string;
	readonly description: string;
	loadPack(): Promise<ScenarioParseResult>;
	readonly save?: DataSourceAction<[ScenarioPack]>;
	readonly reset?: DataSourceAction;
}
