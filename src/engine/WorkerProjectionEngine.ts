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
import ProjectionWorker from "@/workers/projectionWorker?worker";
import StochasticWorker from "@/workers/stochasticWorker?worker";
import type {
	ProjectionWorkerRequest,
	StochasticWorkerRequest,
} from "@/workers/types";
import {
	isProjectionWorkerResponseEnvelope,
	isStochasticWorkerProgressEnvelope,
	isStochasticWorkerResponseEnvelope,
} from "@/workers/types";

function toError(error: unknown, fallback: string): Error {
	if (error instanceof DOMException) return new Error(error.message);
	return error instanceof Error ? error : new Error(fallback);
}

type WithoutId<T> = T extends { id: number } ? Omit<T, "id"> : never;
type ProjectionWorkerPayload = WithoutId<ProjectionWorkerRequest>;

type WorkerMessageOutcome<T> =
	| { type: "continue" }
	| { type: "resolve"; result: T }
	| { type: "reject"; error: Error };

interface WorkerTransportOptions<TRequest, TResult> {
	createWorker: () => Worker;
	request: TRequest;
	signal?: AbortSignal;
	crashMessage: string;
	unreadableMessage: string;
	postMessageFallback: string;
	decodeMessage: (data: unknown) => WorkerMessageOutcome<TResult>;
}

export class WorkerProjectionEngine implements ProjectionComputationEngine {
	private runWorker<TRequest, TResult>({
		createWorker,
		request,
		signal,
		crashMessage,
		unreadableMessage,
		postMessageFallback,
		decodeMessage,
	}: WorkerTransportOptions<TRequest, TResult>): Promise<TResult> {
		const worker = createWorker();

		return new Promise<TResult>((resolve, reject) => {
			let settled = false;
			const abortHandler = () => {
				finish(() => reject(new DOMException("Aborted", "AbortError")));
			};
			const cleanup = () => {
				signal?.removeEventListener("abort", abortHandler);
				worker.onmessage = null;
				worker.onerror = null;
				worker.onmessageerror = null;
				worker.terminate();
			};
			const finish = (settle: () => void) => {
				if (settled) return;
				settled = true;
				cleanup();
				settle();
			};

			if (signal?.aborted) {
				abortHandler();
				return;
			}

			signal?.addEventListener("abort", abortHandler, { once: true });

			worker.onmessage = (event: MessageEvent<unknown>) => {
				if (signal?.aborted) {
					abortHandler();
					return;
				}

				const outcome = decodeMessage(event.data);
				if (outcome.type === "resolve") {
					finish(() => resolve(outcome.result));
				} else if (outcome.type === "reject") {
					finish(() => reject(outcome.error));
				}
			};
			worker.onerror = (event) => {
				const detail = event?.message?.trim() ?? "";
				const message = detail ? `${crashMessage} ${detail}` : crashMessage;
				finish(() => reject(new Error(message)));
			};
			worker.onmessageerror = () => {
				finish(() => reject(new Error(unreadableMessage)));
			};

			try {
				worker.postMessage(request);
			} catch (error) {
				finish(() => reject(toError(error, postMessageFallback)));
			}
		});
	}

	private runProjectionWorker<T>(
		payload: ProjectionWorkerPayload,
		signal: AbortSignal | undefined,
	): Promise<T> {
		const request = { ...payload, id: 1 } as ProjectionWorkerRequest;

		return this.runWorker<ProjectionWorkerRequest, T>({
			createWorker: () => new ProjectionWorker(),
			request,
			signal,
			crashMessage: "Projection worker crashed.",
			unreadableMessage: "Projection worker returned an unreadable message.",
			postMessageFallback: "Could not send projection worker request.",
			decodeMessage: (data) => {
				if (
					!isProjectionWorkerResponseEnvelope(data) ||
					data.id !== request.id
				) {
					return {
						type: "reject",
						error: new Error("Projection worker returned a malformed message."),
					};
				}
				if (data.type !== payload.type) {
					return {
						type: "reject",
						error: new Error(
							"Projection worker returned the wrong result type.",
						),
					};
				}
				if (data.runtimeError) {
					return { type: "reject", error: new Error(data.runtimeError) };
				}
				if (data.result) {
					return { type: "resolve", result: data.result as T };
				}
				return { type: "reject", error: new Error("No result returned") };
			},
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
		const payload: StochasticWorkerRequest = {
			id: 1,
			document: request.document,
			projectionSettings: request.projectionSettings,
			overrides: request.overrides,
			config: request.config,
		};

		return this.runWorker<StochasticWorkerRequest, StochasticProjectionResult>({
			createWorker: () => new StochasticWorker(),
			request: payload,
			signal: request.signal,
			crashMessage: "Stochastic worker crashed.",
			unreadableMessage: "Stochastic worker returned an unreadable message.",
			postMessageFallback: "Could not send stochastic worker request.",
			decodeMessage: (data) => {
				if (isStochasticWorkerProgressEnvelope(data)) {
					if (data.id !== payload.id) {
						return {
							type: "reject",
							error: new Error(
								"Stochastic worker returned a malformed message.",
							),
						};
					}
					try {
						onProgress?.(
							data.progress,
							data.partial as StochasticProjectionResult | undefined,
						);
					} catch (error) {
						return {
							type: "reject",
							error: toError(error, "Stochastic progress callback failed."),
						};
					}
					return { type: "continue" };
				}

				if (
					!isStochasticWorkerResponseEnvelope(data) ||
					data.id !== payload.id
				) {
					return {
						type: "reject",
						error: new Error("Stochastic worker returned a malformed message."),
					};
				}
				if (data.runtimeError) {
					return { type: "reject", error: new Error(data.runtimeError) };
				}
				if (data.result) {
					return {
						type: "resolve",
						result: data.result as StochasticProjectionResult,
					};
				}
				return { type: "reject", error: new Error("No result returned") };
			},
		});
	}
}
