import { projectCsvScenarioPack } from "@/lib/projection";
import type { CsvProjectionResult, CsvScenarioPack, CsvScenarioWhatIfState, ProjectionRuntimeSettings } from "@/lib/projection";

interface CsvProjectionWorkerRequest {
  id: number;
  pack: CsvScenarioPack;
  projectionSettings: ProjectionRuntimeSettings;
  whatIfState: CsvScenarioWhatIfState;
}

interface CsvProjectionWorkerResponse {
  id: number;
  result: CsvProjectionResult | null;
  runtimeError: string | null;
}

self.onmessage = (event: MessageEvent<CsvProjectionWorkerRequest>) => {
  const { id, pack, projectionSettings, whatIfState } = event.data;

  const response: CsvProjectionWorkerResponse = {
    id,
    result: null,
    runtimeError: null,
  };

  try {
    response.result = projectCsvScenarioPack(pack, projectionSettings, whatIfState);
  } catch {
    response.runtimeError = "The CSV data pack could not be projected.";
  }

  self.postMessage(response);
};
