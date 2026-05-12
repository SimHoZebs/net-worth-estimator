import type {
  ProjectionEngine,
  ProjectionRequest,
  StochasticRequest,
  ProgressCallback,
} from "@/lib/projection/engine/ProjectionEngine";
import type { ProjectionResult, StochasticProjectionResult } from "@/lib/projection";
import type {
  ProjectionWorkerRequest,
  ProjectionWorkerResponse,
  StochasticWorkerRequest,
  StochasticWorkerProgress,
  StochasticWorkerResponse,
} from "@/workers/types";

export class WorkerProjectionEngine implements ProjectionEngine {
  async project(request: ProjectionRequest): Promise<ProjectionResult> {
    const worker = new Worker(
      new URL("../workers/projectionWorker.ts", import.meta.url),
      { type: "module" },
    );
    const { signal } = request;

    return new Promise<ProjectionResult>((resolve, reject) => {
      if (signal?.aborted) {
        worker.terminate();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const abortHandler = () => {
        worker.terminate();
        reject(new DOMException("Aborted", "AbortError"));
      };

      signal?.addEventListener("abort", abortHandler, { once: true });

      worker.onmessage = (event: MessageEvent<ProjectionWorkerResponse>) => {
        signal?.removeEventListener("abort", abortHandler);

        if (signal?.aborted) {
          worker.terminate();
          return;
        }

        const { result, runtimeError } = event.data;
        worker.terminate();

        if (runtimeError) {
          reject(new Error(runtimeError));
        } else {
          resolve(result!);
        }
      };

      worker.onerror = () => {
        signal?.removeEventListener("abort", abortHandler);
        worker.terminate();
        reject(new Error("Projection worker crashed."));
      };

      const payload: ProjectionWorkerRequest = {
        id: 1,
        pack: request.pack,
        projectionSettings: request.projectionSettings,
        whatIfState: request.whatIfState,
      };

      worker.postMessage(payload);
    });
  }

  async projectStochastic(
    request: StochasticRequest,
    onProgress?: ProgressCallback,
  ): Promise<StochasticProjectionResult> {
    const worker = new Worker(
      new URL("../workers/stochasticWorker.ts", import.meta.url),
      { type: "module" },
    );
    const { signal } = request;

    return new Promise<StochasticProjectionResult>((resolve, reject) => {
      if (signal?.aborted) {
        worker.terminate();
        reject(new DOMException("Aborted", "AbortError"));
        return;
      }

      const abortHandler = () => {
        worker.terminate();
        reject(new DOMException("Aborted", "AbortError"));
      };

      signal?.addEventListener("abort", abortHandler, { once: true });

      worker.onmessage = (
        event: MessageEvent<StochasticWorkerProgress | StochasticWorkerResponse>,
      ) => {
        if (signal?.aborted) {
          worker.terminate();
          return;
        }

        const payload = event.data;

        if (payload.type === "progress") {
          onProgress?.(payload.progress, payload.partial);
          return;
        }

        signal?.removeEventListener("abort", abortHandler);

        const { result, runtimeError } = payload;
        worker.terminate();

        if (runtimeError) {
          reject(new Error(runtimeError));
        } else {
          resolve(result!);
        }
      };

      worker.onerror = () => {
        signal?.removeEventListener("abort", abortHandler);
        worker.terminate();
        reject(new Error("Stochastic worker crashed."));
      };

      const payload: StochasticWorkerRequest = {
        id: 1,
        pack: request.pack,
        projectionSettings: request.projectionSettings,
        whatIfState: request.whatIfState,
        config: request.config,
      };

      worker.postMessage(payload);
    });
  }
}
