import { projectCsvScenarioPack } from "@/lib/projection";
import type { CsvProjectionResult, CsvScenarioPack } from "@/lib/projection";

interface CsvProjectionWorkerRequest {
  id: number;
  pack: CsvScenarioPack;
}

interface CsvProjectionWorkerResponse {
  id: number;
  result: CsvProjectionResult | null;
  runtimeError: string | null;
}

self.onmessage = (event: MessageEvent<CsvProjectionWorkerRequest>) => {
  const { id, pack } = event.data;

  const response: CsvProjectionWorkerResponse = {
    id,
    result: null,
    runtimeError: null,
  };

  try {
    response.result = projectCsvScenarioPack(pack);
  } catch {
    response.runtimeError = "The CSV scenario pack could not be projected.";
  }

  self.postMessage(response);
};
