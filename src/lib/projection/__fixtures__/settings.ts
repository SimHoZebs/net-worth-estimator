import type { ProjectionRuntimeSettings } from "../types/scenario";

export function makeSettings(
	overrides: Partial<ProjectionRuntimeSettings> = {},
): ProjectionRuntimeSettings {
	return {
		targetNetWorth: 5000,
		fallbackProjectionStartDate: "2026-01-01",
		horizonYears: 1,
		...overrides,
	};
}
