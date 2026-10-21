import type { BackendCheckpoint } from "./contracts.ts";

/** Latest saved observation on or before a date. Equal dates keep row order. */
export function latestCheckpoint(
	checkpoints: readonly BackendCheckpoint[],
	accountId: string,
	through: string,
): BackendCheckpoint | null {
	let latest: BackendCheckpoint | null = null;
	for (const checkpoint of checkpoints) {
		if (checkpoint.AccountId !== accountId || checkpoint.Date > through)
			continue;
		if (latest === null || checkpoint.Date > latest.Date) latest = checkpoint;
	}
	return latest;
}
