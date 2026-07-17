import type { IsoDate, ProjectionPath } from "../types/scenario";

export interface NetWorthThresholdPathResult {
	reached: boolean;
	firstReachedDate: IsoDate | null;
}

export function evaluateNetWorthThreshold(
	path: ProjectionPath,
	target: number | undefined,
): NetWorthThresholdPathResult {
	if (target === undefined || !Number.isFinite(target)) {
		return { reached: false, firstReachedDate: null };
	}
	const firstReachedDate =
		path.rows.find((row) => !row.isHistorical && row.netWorth >= target)
			?.date ?? null;
	return {
		reached: firstReachedDate !== null,
		firstReachedDate,
	};
}
