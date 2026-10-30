import type { BackendCheckpoint } from "../api/contracts.ts";
import type { Projection } from "./result.ts";

/** Compare engine totals, never individual checkpoints or chart-window fills. */
export function netWorthChangeSinceFirstSync(
	projection: Projection,
	checkpoints: readonly BackendCheckpoint[],
) {
	const firstSyncDate = checkpoints
		.filter((checkpoint) => checkpoint.source === "simplefin")
		.map((checkpoint) =>
			new Date(checkpoint.observedAt * 1000).toISOString().slice(0, 10),
		)
		.reduce<string | null>(
			(first, day) => (first === null || day < first ? day : first),
			null,
		);
	if (!firstSyncDate) return null;
	// Imported transactions can precede the first sync. Only the exact engine
	// row for the first synced balance is a valid baseline.
	const baseline = projection.points.find(
		(point) => point.date === firstSyncDate,
	);
	if (!baseline) return null;
	const amount = projection.currentNetWorth - baseline.total;
	return {
		date: firstSyncDate,
		amount,
		// A smaller debt is an improvement. Zero has no percentage baseline.
		fraction: baseline.total === 0 ? null : amount / Math.abs(baseline.total),
	};
}
