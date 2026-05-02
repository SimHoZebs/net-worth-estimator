import type { DataSource, ScenarioParseResult } from "../../dataSource";
import { loadCsvScenarioPack, type CsvScenarioLoadOptions } from "./csvLoader";

export function createCsvDataSource(options?: CsvScenarioLoadOptions): DataSource {
  return {
    sourceType: "csv",
    loadPack: async (): Promise<ScenarioParseResult> => {
      const result = await loadCsvScenarioPack(options);
      return {
        pack: result.data,
        issues: result.issues,
      };
    },
  };
}
