import type { StochasticConfig } from "../types/stochastic";

export function normalizeStochasticConfig(
	config: StochasticConfig,
): StochasticConfig {
	return {
		...config,
		runCount: Number.isFinite(config.runCount)
			? Math.max(1, Math.min(10_000, Math.trunc(config.runCount)))
			: 1,
	};
}
