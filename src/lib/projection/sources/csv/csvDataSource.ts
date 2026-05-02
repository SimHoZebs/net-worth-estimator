import type { DataSource, ScenarioParseResult } from "../../dataSource";
import type { ScenarioPack } from "../../types/scenario";

export interface CsvDataSourceOptions {
  apiPath?: string;
  fetchImpl?: typeof fetch;
}

export function createCsvDataSource(options?: CsvDataSourceOptions): DataSource {
  const apiPath = options?.apiPath ?? "/api/scenario";
  const fetchImpl = options?.fetchImpl ?? fetch;

  return {
    sourceType: "csv",
    loadPack: async (): Promise<ScenarioParseResult> => {
      const response = await fetchImpl(`${apiPath}/pack`);

      if (!response.ok) {
        throw new Error(`Failed to load scenario pack (${response.status} ${response.statusText}).`);
      }

      return response.json() as Promise<ScenarioParseResult>;
    },
    savePack: async (pack: ScenarioPack): Promise<ScenarioParseResult> => {
      const response = await fetchImpl(`${apiPath}/pack`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(pack),
      });

      if (!response.ok) {
        throw new Error(`Failed to save scenario pack (${response.status} ${response.statusText}).`);
      }

      return response.json() as Promise<ScenarioParseResult>;
    },
  };
}
