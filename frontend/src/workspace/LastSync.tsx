import type { ServerStatus } from "../api/index.ts";

// An instant uses the viewer's time zone, not the server's UTC display.
const syncTimeFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

/** Display server-reported freshness without knowledge of its sync provider. */
export function LastSync({ status }: { status: ServerStatus | null }) {
	if (status?.lastSyncAt) {
		const time = new Date(status.lastSyncAt);
		if (Number.isNaN(time.getTime())) return <span>Sync time unavailable</span>;
		return (
			<time dateTime={status.lastSyncAt}>
				Last synced {syncTimeFormat.format(time)}
			</time>
		);
	}
	if (status?.syncConfigured === false) return <span>Sync not configured</span>;
	if (status?.syncConfigured === true) return <span>Never synced</span>;
	return <span>Sync status unavailable</span>;
}
