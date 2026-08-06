import { StochasticProjectionSession } from "@/lib/projection/analysis/projectStochastic";
import StochasticPathWorker from "@/workers/stochasticPathWorker?worker";
import {
	getStochasticPathWorkerCount,
	runStochasticWorkerPool,
} from "./stochasticWorkerPool";
import type {
	StochasticWorkerProgress,
	StochasticWorkerRequest,
	StochasticWorkerResponse,
} from "./types";

self.onmessage = async (event: MessageEvent<StochasticWorkerRequest>) => {
	const { id, document, projectionSettings, overrides, config, incomeData } =
		event.data;

	try {
		const session = new StochasticProjectionSession(
			document,
			projectionSettings,
			overrides,
			config,
			(progress, partial) => {
				const msg: StochasticWorkerProgress = {
					id,
					progress,
					type: "progress",
					partial,
				};
				self.postMessage(msg);
			},
			incomeData,
		);
		const workerCount = getStochasticPathWorkerCount(
			session.config.runCount,
			navigator.hardwareConcurrency,
		);
		const result = await runStochasticWorkerPool(
			session,
			workerCount,
			() => new StochasticPathWorker(),
		);

		const response: StochasticWorkerResponse = {
			id,
			result,
			runtimeError: null,
			type: "result",
		};

		self.postMessage(response);
	} catch (err) {
		const response: StochasticWorkerResponse = {
			id,
			result: null,
			runtimeError:
				err instanceof Error ? err.message : "Stochastic projection failed.",
			type: "result",
		};

		self.postMessage(response);
	}
};
