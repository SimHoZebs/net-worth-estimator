import { projectCsvScenarioPack } from "@/lib/projection";
import type { CsvProjectionResult, CsvScenarioPack, CsvScenarioWhatIfState } from "@/lib/projection";

interface CsvProjectionWorkerRequest {
  id: number;
  pack: CsvScenarioPack;
  whatIfState: CsvScenarioWhatIfState;
}

interface CsvProjectionWorkerResponse {
  id: number;
  result: CsvProjectionResult | null;
  runtimeError: string | null;
}

self.onmessage = (event: MessageEvent<CsvProjectionWorkerRequest>) => {
  const { id, pack, whatIfState } = event.data;

  const response: CsvProjectionWorkerResponse = {
    id,
    result: null,
    runtimeError: null,
  };

  try {
    response.result = projectCsvScenarioPack(pack, whatIfState);
  } catch {
    response.runtimeError = "The CSV scenario pack could not be projected.";
  }

  self.postMessage(response);
};
