import type { IsoDate, NetWorthThresholdConfig } from "../types/model";

export const NET_WORTH_THRESHOLD_DEFINITION_ID = "net-worth-threshold";

export interface NetWorthThresholdPathResult {
	reached: boolean;
	firstReachedDate: IsoDate | null;
}

export interface NetWorthThresholdProbabilisticResult {
	probability: number;
	p10ReachedDate: IsoDate | null;
	medianReachedDate: IsoDate | null;
	p90ReachedDate: IsoDate | null;
}

export function validateNetWorthThresholdConfig(
	config: unknown,
): NetWorthThresholdConfig {
	if (
		typeof config !== "object" ||
		config === null ||
		!("target" in config) ||
		typeof config.target !== "number" ||
		!Number.isFinite(config.target)
	) {
		throw new Error("Net worth threshold target must be a finite number.");
	}
	return { target: config.target };
}
