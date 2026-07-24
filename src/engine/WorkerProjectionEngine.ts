import type {
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";
import type {
	ProgressCallback,
	ProjectionEngine,
	ProjectionRequest,
	StochasticRequest,
} from "@/lib/projection/runtime/ProjectionEngine";
import type {
	ProjectionWorkerRequest,
	ProjectionWorkerResponse,
	StochasticWorkerProgress,
	StochasticWorkerRequest,
	StochasticWorkerResponse,
} from "@/workers/types";

function toError(error: unknown, fallback: string): Error {
	if (error instanceof DOMException) return new Error(error.message);
	return error instanceof Error ? error : new Error(fallback);
}

export class WorkerProjectionEngine implements ProjectionEngine {
	async project(request: ProjectionRequest): Promise<ProjectionResult> {
		const worker = new Worker(
			new URL("../workers/projectionWorker.ts", import.meta.url),
			{
				type: "module",
			},
		);
		const { signal } = request;

		return new Promise<ProjectionResult>((resolve, reject) => {
			let abortHandler: (() => void) | undefined;
			const cleanup = () => {
				if (abortHandler) signal?.removeEventListener("abort", abortHandler);
				worker.terminate();
			};
			if (signal?.aborted) {
				cleanup();
				reject(new DOMException("Aborted", "AbortError"));
				return;
			}

			abortHandler = () => {
				cleanup();
				reject(new DOMException("Aborted", "AbortError"));
			};

			signal?.addEventListener("abort", abortHandler, { once: true });

			worker.onmessage = (event: MessageEvent<ProjectionWorkerResponse>) => {
				if (signal?.aborted) {
					cleanup();
					return;
				}

				const { result, runtimeError } = event.data;
				cleanup();

				if (runtimeError) {
					reject(new Error(runtimeError));
				} else if (result) {
					resolve(result);
				} else {
					reject(new Error("No result returned"));
				}
			};

			worker.onerror = () => {
				cleanup();
				reject(new Error("Projection worker crashed."));
			};
			worker.onmessageerror = () => {
				cleanup();
				reject(new Error("Projection worker returned an unreadable message."));
			};

			const payload: ProjectionWorkerRequest = {
				id: 1,
				document: request.document,
				projectionSettings: request.projectionSettings,
				overrides: request.overrides,
			};

			try {
				worker.postMessage(payload);
			} catch (error) {
				cleanup();
				reject(toError(error, "Could not send projection worker request."));
			}
		});
	}

	async projectStochastic(
		request: StochasticRequest,
		onProgress?: ProgressCallback,
	): Promise<StochasticProjectionResult> {
		const worker = new Worker(
			new URL("../workers/stochasticWorker.ts", import.meta.url),
			{
				type: "module",
			},
		);
		const { signal } = request;

		return new Promise<StochasticProjectionResult>((resolve, reject) => {
			let abortHandler: (() => void) | undefined;
			const cleanup = () => {
				if (abortHandler) signal?.removeEventListener("abort", abortHandler);
				worker.terminate();
			};
			if (signal?.aborted) {
				cleanup();
				reject(new DOMException("Aborted", "AbortError"));
				return;
			}

			abortHandler = () => {
				cleanup();
				reject(new DOMException("Aborted", "AbortError"));
			};

			signal?.addEventListener("abort", abortHandler, { once: true });

			worker.onmessage = (
				event: MessageEvent<
					StochasticWorkerProgress | StochasticWorkerResponse
				>,
			) => {
				if (signal?.aborted) {
					cleanup();
					return;
				}

				const payload = event.data;

				if (payload.type === "progress") {
					try {
						onProgress?.(payload.progress, payload.partial);
					} catch (error) {
						cleanup();
						reject(toError(error, "Stochastic progress callback failed."));
					}
					return;
				}

				const { result, runtimeError } = payload;
				cleanup();

				if (runtimeError) {
					reject(new Error(runtimeError));
				} else if (result) {
					resolve(result);
				} else {
					reject(new Error("No result returned"));
				}
			};

			worker.onerror = () => {
				cleanup();
				reject(new Error("Stochastic worker crashed."));
			};
			worker.onmessageerror = () => {
				cleanup();
				reject(new Error("Stochastic worker returned an unreadable message."));
			};

			const payload: StochasticWorkerRequest = {
				id: 1,
				document: request.document,
				projectionSettings: request.projectionSettings,
				overrides: request.overrides,
				config: request.config,
			};

			try {
				worker.postMessage(payload);
			} catch (error) {
				cleanup();
				reject(toError(error, "Could not send stochastic worker request."));
			}
		});
	}
}
