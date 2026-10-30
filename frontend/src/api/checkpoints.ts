import type { BackendCheckpoint } from "./contracts.ts";

/** Ordering instant of one observation: its required exact Unix time. */
export function checkpointInstant(checkpoint: BackendCheckpoint): number {
	return checkpoint.observedAt;
}

/** Owner-authored rows win same-instant ties, mirroring the backend replay. */
function isOwnerCheckpoint(checkpoint: BackendCheckpoint): boolean {
	const source = checkpoint.source ?? "";
	return source === "" || source === "user" || source === "model";
}

/**
 * Latest saved observation on or before a date. The day derives from the
 * instant only at this presentation boundary; there is no canonical Date.
 * At the same instant an owner row wins regardless of input order; rows
 * of equal authorship resolve to the later row, mirroring the backend
 * replay's stable overwrite. backend/internal/domain/chrono.go owns this
 * read-only selection policy. This helper never computes account balances.
 */
export function latestCheckpoint(
	checkpoints: readonly BackendCheckpoint[],
	accountId: string,
	through: string,
): BackendCheckpoint | null {
	let latest: BackendCheckpoint | null = null;
	let latestInstant = -1;
	for (const checkpoint of checkpoints) {
		if (checkpoint.AccountId !== accountId) continue;
		const instant = checkpointInstant(checkpoint);
		const day = new Date(instant * 1000).toISOString().slice(0, 10);
		if (day > through) continue;
		if (latest === null || instant > latestInstant) {
			latest = checkpoint;
			latestInstant = instant;
			continue;
		}
		if (instant === latestInstant) {
			const owner = isOwnerCheckpoint(checkpoint);
			const latestOwner = isOwnerCheckpoint(latest);
			if ((owner && !latestOwner) || owner === latestOwner) {
				latest = checkpoint;
			}
		}
	}
	return latest;
}

export function checkpointDay(checkpoint: BackendCheckpoint): string {
	return new Date(checkpoint.observedAt * 1000).toISOString().slice(0, 10);
}
