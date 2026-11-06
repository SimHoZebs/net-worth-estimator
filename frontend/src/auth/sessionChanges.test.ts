import { afterEach, describe, expect, it, vi } from "vitest";
import {
	announceSessionChange,
	listenForSessionChanges,
} from "./sessionChanges.ts";

afterEach(() => vi.unstubAllGlobals());

describe("cross-tab session signals", () => {
	it("uses storage signals and storage clears only to request a server recheck", () => {
		vi.stubGlobal("BroadcastChannel", undefined);
		const check = vi.fn();
		const stop = listenForSessionChanges(check);
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "other-preference",
				newValue: "private-id",
			}),
		);
		expect(check).not.toHaveBeenCalled();
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "waypoint.session-change.v1",
				newValue: "untrusted-resource",
			}),
		);
		expect(check).not.toHaveBeenCalled();
		window.dispatchEvent(
			new StorageEvent("storage", {
				key: "waypoint.session-change.v1",
				newValue: JSON.stringify({
					type: "session-changed",
					source: "another-document",
				}),
			}),
		);
		expect(check).toHaveBeenCalledTimes(1);
		window.dispatchEvent(new StorageEvent("storage", { key: null }));
		expect(check).toHaveBeenCalledTimes(2);
		stop();
		window.dispatchEvent(new StorageEvent("storage", { key: null }));
		expect(check).toHaveBeenCalledTimes(2);
	});

	it("publishes no identity or financial data and ignores its own broadcast", () => {
		const channels: {
			onmessage: ((event: MessageEvent) => void) | null;
			postMessage: ReturnType<typeof vi.fn>;
			close: ReturnType<typeof vi.fn>;
		}[] = [];
		class Channel {
			onmessage: ((event: MessageEvent) => void) | null = null;
			postMessage = vi.fn();
			close = vi.fn();
			constructor() {
				channels.push(this);
			}
		}
		vi.stubGlobal("BroadcastChannel", Channel);
		const check = vi.fn();
		const stop = listenForSessionChanges(check);
		announceSessionChange();
		const signal = channels[1]!.postMessage.mock.calls[0]![0];
		expect(Object.keys(signal).sort()).toEqual(["source", "type"]);
		expect(signal.type).toBe("session-changed");
		expect(channels[1]!.close).toHaveBeenCalledOnce();
		// The announcing document hears its own message through a second
		// channel object; it must not schedule a redundant verification.
		channels[0]!.onmessage?.(new MessageEvent("message", { data: signal }));
		expect(check).not.toHaveBeenCalled();
		channels[0]!.onmessage?.(
			new MessageEvent("message", { data: { resource: "untrusted" } }),
		);
		expect(check).not.toHaveBeenCalled();
		channels[0]!.onmessage?.(
			new MessageEvent("message", {
				data: { type: "session-changed", source: "another-document" },
			}),
		);
		expect(check).toHaveBeenCalledOnce();
		stop();
		expect(channels[0]!.close).toHaveBeenCalledOnce();
	});
});
