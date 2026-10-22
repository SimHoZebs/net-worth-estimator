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
		window.dispatchEvent(new StorageEvent("storage", { key: null }));
		expect(check).toHaveBeenCalledTimes(2);
		stop();
		window.dispatchEvent(new StorageEvent("storage", { key: null }));
		expect(check).toHaveBeenCalledTimes(2);
	});

	it("publishes no identity or financial data and releases broadcast channels", () => {
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
		expect(channels[1]!.postMessage).toHaveBeenCalledExactlyOnceWith(
			"session-changed",
		);
		expect(channels[1]!.close).toHaveBeenCalledOnce();
		channels[0]!.onmessage?.(
			new MessageEvent("message", { data: { resource: "untrusted" } }),
		);
		expect(check).not.toHaveBeenCalled();
		channels[0]!.onmessage?.(
			new MessageEvent("message", { data: "session-changed" }),
		);
		expect(check).toHaveBeenCalledOnce();
		stop();
		expect(channels[0]!.close).toHaveBeenCalledOnce();
	});
});
