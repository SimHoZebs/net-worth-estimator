import type { BackendCheckpoint } from "./contracts.ts";
import { isoDateFromEpochSeconds } from "../domain/format.ts";

/** Ordering instant of one observation: its required exact Unix time. */
export function checkpointInstant(checkpoint: BackendCheckpoint): number {
	return checkpoint.observedAt;
}

/** Owner-authored rows win same-instant ties, mirroring the backend replay. */
function isOwnerCheckpoint(checkpoint: BackendCheckpoint): boolean {
	const source = checkpoint.source ?? "";
	return source === "" || source === "user";
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
	return latestCheckpointsThrough(checkpoints, through).get(accountId) ?? null;
}

/**
 * Latest saved observation per account on or before a date, in one pass.
 * Use this instead of latestCheckpoint per card to avoid rescanning the
 * checkpoint list once per card.
 */
export function latestCheckpointsThrough(
	checkpoints: readonly BackendCheckpoint[],
	through: string,
): Map<string, BackendCheckpoint> {
	const latestByAccount = new Map<string, BackendCheckpoint>();
	const instantByAccount = new Map<string, number>();
	for (const checkpoint of checkpoints) {
		const instant = checkpointInstant(checkpoint);
		const day = isoDateFromEpochSeconds(instant);
		if (day > through) continue;
		const accountId = checkpoint.AccountId;
		const latest = latestByAccount.get(accountId);
		if (latest === undefined) {
			latestByAccount.set(accountId, checkpoint);
			instantByAccount.set(accountId, instant);
			continue;
		}
		const latestInstant = instantByAccount.get(accountId)!;
		if (instant > latestInstant) {
			latestByAccount.set(accountId, checkpoint);
			instantByAccount.set(accountId, instant);
			continue;
		}
		if (instant === latestInstant) {
			const owner = isOwnerCheckpoint(checkpoint);
			const latestOwner = isOwnerCheckpoint(latest);
			if ((owner && !latestOwner) || owner === latestOwner) {
				latestByAccount.set(accountId, checkpoint);
			}
		}
	}
	return latestByAccount;
}

export function checkpointDay(checkpoint: BackendCheckpoint): string {
	return isoDateFromEpochSeconds(checkpoint.observedAt);
}
