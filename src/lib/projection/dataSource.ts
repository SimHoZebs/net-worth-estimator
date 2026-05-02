import type { ScenarioPack } from "./types/scenario";
import type { ScenarioValidationIssue } from "./types/validation";

export interface ScenarioParseResult {
  pack: ScenarioPack | null;
  issues: ScenarioValidationIssue[];
}

export interface DataSource {
  readonly sourceType: string;
  loadPack(): Promise<ScenarioParseResult>;
  savePack(pack: ScenarioPack): Promise<ScenarioParseResult>;
}
