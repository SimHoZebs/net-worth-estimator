import type {
	ProjectionPath,
	StochasticProjectionResult,
} from "@/lib/projection";
import type {
	MonteCarloSample,
	PreparedProjection,
} from "@/lib/projection/types/simulation";
import type {
	StochasticPathWorkerRequest,
	StochasticPathWorkerResponse,
} from "./stochasticPathTypes";
import { decodeProjectionPath } from "./types";

const MAX_PATH_WORKERS = 4;
const TARGET_RUNS_PER_WORKER = 50;

export function getStochasticPathWorkerCount(
	runCount: number,
	hardwareConcurrency: number | undefined,
): number {
	const normalizedRuns = Math.max(1, Math.trunc(runCount));
	const logicalProcessors =
		typeof hardwareConcurrency === "number" &&
		Number.isFinite(hardwareConcurrency) &&
		hardwareConcurrency > 0
			? Math.trunc(hardwareConcurrency)
			: 2;
	return Math.max(
		1,
		Math.min(
			MAX_PATH_WORKERS,
			normalizedRuns,
			Math.ceil(normalizedRuns / TARGET_RUNS_PER_WORKER),
			Math.max(1, logicalProcessors - 2),
		),
	);
}

type WorkerFactory = () => Worker;

export interface StochasticPoolSession {
	config: { runCount: number };
	prepared: PreparedProjection;
	createSample(): MonteCarloSample;
	consumeSample(path: ProjectionPath, sample: MonteCarloSample): void;
	result(): StochasticProjectionResult;
}

interface WorkerSlot {
	worker: Worker;
	ready: boolean;
	runIndex: number | null;
}

function isResponse(value: unknown): value is StochasticPathWorkerResponse {
	if (typeof value !== "object" || value === null || !("type" in value)) {
		return false;
	}
	const candidate = value as Record<string, unknown>;
	if (candidate.type === "ready") return true;
	if (candidate.type === "error") {
		return (
			(candidate.runIndex === null || Number.isInteger(candidate.runIndex)) &&
			typeof candidate.message === "string"
		);
	}
	return (
		candidate.type === "result" &&
		Number.isInteger(candidate.runIndex) &&
		decodeProjectionPath(candidate.path) !== null
	);
}

export function runStochasticWorkerPool(
	session: StochasticPoolSession,
	workerCount: number,
	createWorker: WorkerFactory,
): Promise<StochasticProjectionResult> {
	return new Promise((resolve, reject) => {
		const slots: WorkerSlot[] = [];
		const samples = new Map<number, MonteCarloSample>();
		const completed = new Map<
			number,
			Extract<StochasticPathWorkerResponse, { type: "result" }>["path"]
		>();
		let nextRunIndex = 0;
		let nextRunToConsume = 0;
		let readyCount = 0;
		let settled = false;

		const cleanup = () => {
			for (const slot of slots) {
				slot.worker.onmessage = null;
				slot.worker.onerror = null;
				slot.worker.onmessageerror = null;
				slot.worker.terminate();
			}
		};
		const fail = (error: unknown) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(
				error instanceof Error
					? error
					: new Error("Stochastic path worker failed."),
			);
		};
		const finish = () => {
			if (settled) return;
			settled = true;
			cleanup();
			resolve(session.result());
		};
		const post = (slot: WorkerSlot, request: StochasticPathWorkerRequest) => {
			try {
				slot.worker.postMessage(request);
			} catch (error) {
				fail(error);
			}
		};

		const dispatch = () => {
			if (settled || readyCount !== slots.length) return;
			for (const slot of slots) {
				if (
					slot.runIndex !== null ||
					nextRunIndex >= session.config.runCount ||
					nextRunIndex >= nextRunToConsume + workerCount
				) {
					continue;
				}
				const runIndex = nextRunIndex++;
				const sample = session.createSample();
				samples.set(runIndex, sample);
				slot.runIndex = runIndex;
				post(slot, { type: "run", runIndex, sample });
			}
		};

		const consumeCompleted = () => {
			while (completed.has(nextRunToConsume)) {
				const path = completed.get(nextRunToConsume);
				const sample = samples.get(nextRunToConsume);
				if (!path || !sample) {
					throw new Error("Stochastic worker pool lost a completed path.");
				}
				completed.delete(nextRunToConsume);
				samples.delete(nextRunToConsume);
				session.consumeSample(path, sample);
				nextRunToConsume++;
			}
			if (nextRunToConsume === session.config.runCount) finish();
			else dispatch();
		};

		try {
			for (let index = 0; index < workerCount; index++) {
				const worker = createWorker();
				const slot: WorkerSlot = { worker, ready: false, runIndex: null };
				slots.push(slot);
				worker.onmessage = (event: MessageEvent<unknown>) => {
					if (settled) return;
					try {
						if (!isResponse(event.data)) {
							throw new Error(
								"Stochastic path worker returned a malformed message.",
							);
						}
						const response = event.data;
						if (response.type === "error") throw new Error(response.message);
						if (response.type === "ready") {
							if (slot.ready || slot.runIndex !== null) {
								throw new Error(
									"Stochastic path worker returned an unexpected ready message.",
								);
							}
							slot.ready = true;
							readyCount++;
							dispatch();
							return;
						}
						if (!slot.ready || response.runIndex !== slot.runIndex) {
							throw new Error(
								"Stochastic path worker returned an unexpected run result.",
							);
						}
						slot.runIndex = null;
						completed.set(response.runIndex, response.path);
						consumeCompleted();
					} catch (error) {
						fail(error);
					}
				};
				worker.onerror = (event) => {
					const detail = event.message?.trim();
					fail(
						new Error(
							detail
								? `Stochastic path worker crashed. ${detail}`
								: "Stochastic path worker crashed.",
						),
					);
				};
				worker.onmessageerror = () => {
					fail(
						new Error("Stochastic path worker returned an unreadable message."),
					);
				};
			}
			for (const slot of slots) {
				post(slot, { type: "initialize", prepared: session.prepared });
			}
		} catch (error) {
			fail(error);
		}
	});
}
