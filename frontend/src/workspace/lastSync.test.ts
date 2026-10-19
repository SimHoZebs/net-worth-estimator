import { describe, expect, it } from "vitest";
import { formatLastSyncTime, lastSyncLabel } from "./lastSync.ts";

describe("sidebar last-sync label", () => {
	it("reports an unavailable status", () => {
		expect(lastSyncLabel(null)).toBe("Sync status unavailable");
	});

	it("reports an unconfigured sync", () => {
		expect(lastSyncLabel({ readOnly: false, authEnabled: false })).toBe(
			"Never synced",
		);
		expect(
			lastSyncLabel({
				readOnly: false,
				authEnabled: false,
				syncConfigured: false,
			}),
		).toBe("Sync not configured");
	});

	it("renders a recorded sync time in browser time", () => {
		const label = lastSyncLabel({
			readOnly: false,
			authEnabled: false,
			syncConfigured: true,
			lastSyncAt: "2026-10-18T14:30:00Z",
		});
		expect(label.startsWith("Last synced ")).toBe(true);
		expect(label).not.toContain("2026-10-18T14:30:00Z");
	});

	it("rejects an unreadable sync time", () => {
		expect(formatLastSyncTime("not-a-time")).toBeNull();
		expect(
			lastSyncLabel({
				readOnly: false,
				authEnabled: false,
				syncConfigured: true,
				lastSyncAt: "not-a-time",
			}),
		).toBe("Sync time unavailable");
	});
});
