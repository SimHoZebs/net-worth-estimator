import { projectScenarioPack } from "@/lib/projection";
import type {
  ProjectionWorkerRequest,
  ProjectionWorkerResponse,
} from "./types";

self.onmessage = (event: MessageEvent<ProjectionWorkerRequest>) => {
  const { id, pack, projectionSettings, whatIfState } = event.data;

  const response: ProjectionWorkerResponse = {
    id,
    result: null,
    runtimeError: null,
  };

  try {
    response.result = projectScenarioPack(pack, projectionSettings, whatIfState);
  } catch (err) {
    response.runtimeError = err instanceof Error ? err.message : "The data pack could not be projected.";
  }

  self.postMessage(response);
};
