const SESSION_CHANGE_KEY = "waypoint.session-change.v1";
const CHANNEL_NAME = "waypoint-session";

/** Signals carry no identity, resource ID, or financial data. Re-fetch the server. */
export function announceSessionChange(): void {
	try {
		if (typeof BroadcastChannel !== "undefined") {
			const channel = new BroadcastChannel(CHANNEL_NAME);
			channel.postMessage("session-changed");
			channel.close();
			return;
		}
	} catch {
		// Storage events also work when BroadcastChannel is unavailable or blocked.
	}
	try {
		window.localStorage.setItem(SESSION_CHANGE_KEY, crypto.randomUUID());
	} catch {
		// Focus and response-header checks remain active without browser storage.
	}
}

export function listenForSessionChanges(check: () => void): () => void {
	const storageChanged = (event: StorageEvent) => {
		if (event.key === SESSION_CHANGE_KEY || event.key === null) check();
	};
	window.addEventListener("storage", storageChanged);
	let channel: BroadcastChannel | null = null;
	try {
		if (typeof BroadcastChannel !== "undefined") {
			channel = new BroadcastChannel(CHANNEL_NAME);
			channel.onmessage = (event: MessageEvent<unknown>) => {
				if (event.data === "session-changed") check();
			};
		}
	} catch {
		// The storage listener remains the fallback.
	}
	return () => {
		window.removeEventListener("storage", storageChanged);
		channel?.close();
	};
}
