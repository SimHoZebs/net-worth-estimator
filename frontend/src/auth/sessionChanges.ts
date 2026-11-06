const SESSION_CHANGE_KEY = "waypoint.session-change.v1";
const CHANNEL_NAME = "waypoint-session";

// One identity per document. BroadcastChannel echoes messages to every
// channel object in the same document, so the announcer must recognize its
// own signal or every session change schedules a redundant verification.
// randomUUID is secure-context-only; private-HTTP LAN origins need the
// getRandomValues fallback so module evaluation never throws at boot.
function createSource(): string {
	try {
		if (typeof crypto !== "undefined") {
			if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
			if (typeof crypto.getRandomValues === "function") {
				const bytes = new Uint8Array(16);
				crypto.getRandomValues(bytes);
				return Array.from(bytes, (byte) =>
					byte.toString(16).padStart(2, "0"),
				).join("");
			}
		}
	} catch {
		// Fall through to the counter text below.
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const source = createSource();

interface SessionChangeSignal {
	type: "session-changed";
	source: string;
}

function isSignal(value: unknown): value is SessionChangeSignal {
	return (
		typeof value === "object" &&
		value !== null &&
		(value as { type?: unknown }).type === "session-changed" &&
		typeof (value as { source?: unknown }).source === "string"
	);
}

/** Signals carry no identity, resource ID, or financial data. Re-fetch the server. */
export function announceSessionChange(): void {
	const signal: SessionChangeSignal = { type: "session-changed", source };
	try {
		if (typeof BroadcastChannel !== "undefined") {
			const channel = new BroadcastChannel(CHANNEL_NAME);
			channel.postMessage(signal);
			channel.close();
			return;
		}
	} catch {
		// Storage events also work when BroadcastChannel is unavailable or blocked.
	}
	try {
		window.localStorage.setItem(SESSION_CHANGE_KEY, JSON.stringify(signal));
	} catch {
		// Focus and response-header checks remain active without browser storage.
	}
}

export function listenForSessionChanges(check: () => void): () => void {
	const storageChanged = (event: StorageEvent) => {
		if (event.key === null) {
			check();
			return;
		}
		if (event.key !== SESSION_CHANGE_KEY) return;
		try {
			if (isSignal(JSON.parse(event.newValue ?? ""))) check();
		} catch {
			// A malformed value is not a session signal.
		}
	};
	window.addEventListener("storage", storageChanged);
	let channel: BroadcastChannel | null = null;
	try {
		if (typeof BroadcastChannel !== "undefined") {
			channel = new BroadcastChannel(CHANNEL_NAME);
			channel.onmessage = (event: MessageEvent<unknown>) => {
				if (isSignal(event.data) && event.data.source !== source) check();
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
