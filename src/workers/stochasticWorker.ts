import { stochasticProject } from "@/lib/projection";
import type {
	StochasticWorkerProgress,
	StochasticWorkerRequest,
	StochasticWorkerResponse,
} from "./types";

self.onmessage = (event: MessageEvent<StochasticWorkerRequest>) => {
	const { id, document, projectionSettings, overrides, config, incomeData } =
		event.data;

	try {
		const result = stochasticProject(
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
