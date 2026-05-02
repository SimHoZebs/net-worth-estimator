import { projectCsvScenarioPack } from "@/lib/projection";
import type {
  CsvProjectionWorkerRequest,
  CsvProjectionWorkerResponse,
} from "./types";

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
