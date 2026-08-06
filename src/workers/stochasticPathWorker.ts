import { buildProjectionPath } from "@/lib/projection/simulation/projectPath";
import { simulate } from "@/lib/projection/simulation/simulate";
import type { PreparedProjection } from "@/lib/projection/types/simulation";
import type {
	StochasticPathWorkerRequest,
	StochasticPathWorkerResponse,
} from "./stochasticPathTypes";

let prepared: PreparedProjection | null = null;

self.onmessage = (event: MessageEvent<StochasticPathWorkerRequest>) => {
	const request = event.data;
	try {
		if (request.type === "initialize") {
			prepared = request.prepared;
			const response: StochasticPathWorkerResponse = { type: "ready" };
			self.postMessage(response);
			return;
		}
		if (prepared === null) {
			throw new Error("Stochastic path worker was not initialized.");
		}
		const path = buildProjectionPath(
			prepared,
			simulate({ ...prepared.request, monteCarloSample: request.sample }),
		);
		const response: StochasticPathWorkerResponse = {
			type: "result",
			runIndex: request.runIndex,
			path,
		};
		self.postMessage(response);
	} catch (error) {
		const response: StochasticPathWorkerResponse = {
			type: "error",
			runIndex: request.type === "run" ? request.runIndex : null,
			message:
				error instanceof Error
					? error.message
					: "Stochastic path projection failed.",
		};
		self.postMessage(response);
	}
};
