import type { ServerStatus } from "../api/index.ts";

/** Browser-local sync-time rendering. No timeZone means the viewer's zone. */
const syncTimeFormat = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "numeric",
	minute: "2-digit",
});

/** Format an RFC3339 instant in browser time, or null when unreadable. */
export function formatLastSyncTime(value: string): string | null {
	const time = new Date(value).getTime();
	if (Number.isNaN(time)) return null;
	return syncTimeFormat.format(new Date(time));
}

/** Sidebar-bottom sync line for a loaded status, or the empty/unknown copy. */
export function lastSyncLabel(status: ServerStatus | null): string {
	if (!status) return "Sync status unavailable";
	if (status.lastSyncAt) {
		const formatted = formatLastSyncTime(status.lastSyncAt);
		if (formatted) return `Last synced ${formatted}`;
		return "Sync time unavailable";
	}
	if (status.syncConfigured === false) return "Sync not configured";
	return "Never synced";
}
