import { TriangleAlert } from "lucide-react";
import type { ServerStatus } from "../api/index.ts";
import { notifyError } from "../state/notifications.ts";

// An instant uses the viewer's time zone, not the server's UTC display.
const syncTimeFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

/**
 * A configured sync is stale when the last success is older than the
 * six-hour scheduler cadence. Failed runs stay unstamped, so age is the
 * only signal the status endpoint provides.
 */
export const SYNC_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

export function isSyncStale(lastSyncAt: string, now = Date.now()): boolean {
	const time = new Date(lastSyncAt).getTime();
	return !Number.isNaN(time) && now - time > SYNC_STALE_AFTER_MS;
}

function staleSyncMessage(): string {
	return "Bank sync is stale.";
}

/** Display server-reported freshness without knowledge of its sync provider. */
export function LastSync({
	status,
	now,
}: {
	status: ServerStatus | null;
	now?: number;
}) {
	// Freshness is wall-clock age against a fixed server instant: it flips
	// fresh→stale exactly once, so reading the clock here cannot oscillate.
	// oxlint-disable-next-line react/purity
	const effectiveNow = now ?? Date.now();
	if (status?.lastSyncAt) {
		const time = new Date(status.lastSyncAt);
		if (Number.isNaN(time.getTime())) return <span>Sync time unavailable</span>;
		const label = <>Last synced {syncTimeFormat.format(time)}</>;
		if (status.syncConfigured && isSyncStale(status.lastSyncAt, effectiveNow)) {
			return (
				<button
					type="button"
					onClick={() =>
						notifyError("sync-stale", staleSyncMessage(), {
							label: "Open bank sync",
							onAction: () => {
								window.location.hash = "sources";
							},
						})
					}
					className="inline-flex cursor-pointer items-center gap-1 border-0 bg-transparent p-0 text-left text-xs leading-relaxed whitespace-nowrap text-muted hover:text-ink hover:underline hover:underline-offset-4"
				>
					<TriangleAlert
						size={16}
						strokeWidth={2.5}
						aria-hidden="true"
						className="text-warning-text"
					/>
					<time dateTime={status.lastSyncAt}>{label}</time>
					<span className="sr-only">Sync stale</span>
				</button>
			);
		}
		return <time dateTime={status.lastSyncAt}>{label}</time>;
	}
	if (status?.syncConfigured === false) return <span>Sync not configured</span>;
	if (status?.syncConfigured === true) return <span>Never synced</span>;
	return <span>Sync status unavailable</span>;
}
