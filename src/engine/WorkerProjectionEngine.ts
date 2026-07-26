import type {
	EvaluationResultCollection,
	ProjectionResult,
	RawProjectionOutput,
	StochasticProjectionResult,
} from "@/lib/projection";
import type {
	ProgressCallback,
	ProjectionComputationEngine,
	ProjectionEvaluationRequest,
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

type WithoutId<T> = T extends { id: number } ? Omit<T, "id"> : never;
type ProjectionWorkerPayload = WithoutId<ProjectionWorkerRequest>;

export class WorkerProjectionEngine implements ProjectionComputationEngine {
	private runProjectionWorker<T>(
		payload: ProjectionWorkerPayload,
		signal: AbortSignal | undefined,
	): Promise<T> {
		const worker = new Worker(
			new URL("../workers/projectionWorker.ts", import.meta.url),
			{
				type: "module",
			},
		);
		return new Promise<T>((resolve, reject) => {
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

				const { result, runtimeError, type } = event.data;
				cleanup();

				if (type !== payload.type) {
					reject(
						new Error("Projection worker returned the wrong result type."),
					);
				} else if (runtimeError) {
					reject(new Error(runtimeError));
				} else if (result) {
					resolve(result as T);
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

			try {
				worker.postMessage({ ...payload, id: 1 } as ProjectionWorkerRequest);
			} catch (error) {
				cleanup();
				reject(toError(error, "Could not send projection worker request."));
			}
		});
	}

	async project(request: ProjectionRequest): Promise<ProjectionResult> {
		return this.runProjectionWorker<ProjectionResult>(
			{
				type: "complete",
				document: request.document,
				projectionSettings: request.projectionSettings,
				overrides: request.overrides,
			},
			request.signal,
		);
	}

	async projectBase(request: ProjectionRequest): Promise<RawProjectionOutput> {
		return this.runProjectionWorker<RawProjectionOutput>(
			{
				type: "base",
				document: request.document,
				projectionSettings: request.projectionSettings,
				overrides: request.overrides,
			},
			request.signal,
		);
	}

	async evaluateProjection(
		request: ProjectionEvaluationRequest,
	): Promise<EvaluationResultCollection> {
		return this.runProjectionWorker<EvaluationResultCollection>(
			{
				type: "evaluation",
				path: request.path,
				evaluations: request.evaluations,
			},
			request.signal,
		);
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
