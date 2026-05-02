import { stochasticProject } from "@/lib/projection";
import type {
  StochasticWorkerProgress,
  StochasticWorkerRequest,
  StochasticWorkerResponse,
} from "./types";

self.onmessage = (event: MessageEvent<StochasticWorkerRequest>) => {
  const { id, pack, projectionSettings, whatIfState, config } = event.data;

  try {
    const result = stochasticProject(
      pack,
      projectionSettings,
      whatIfState,
      config,
      (progress) => {
        const msg: StochasticWorkerProgress = { id, progress, type: "progress" };
        self.postMessage(msg);
      }
    );

    const response: StochasticWorkerResponse = {
      id,
      result,
      runtimeError: null,
      type: "result",
    };

    self.postMessage(response);
  } catch {
    const response: StochasticWorkerResponse = {
      id,
      result: null,
      runtimeError: "Stochastic projection failed.",
      type: "result",
    };

    self.postMessage(response);
  }
};
