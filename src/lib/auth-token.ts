import { useSyncExternalStore } from "react";

const STORAGE_KEY = "net-worth-estimator:auth-token";

const listeners = new Set<() => void>();

let memoryToken: string | null = null;

function notify() {
	for (const listener of listeners) listener();
}

function readStoredToken(): string | null {
	try {
		const stored = window.localStorage?.getItem(STORAGE_KEY);
		if (stored !== undefined && stored !== null) {
			memoryToken = stored;
			return stored;
		}
	} catch {
		// Storage unavailable (private mode, SSR, jsdom without URL).
	}
	return memoryToken;
}

/**
 * Backend bearer token for canonical model writes. Persisted in localStorage
 * so a reload does not sign the owner out; never logged, never sent except
 * as an Authorization header on save. Reads and projections never carry it.
 */
export function getAuthToken(): string | null {
	if (typeof window === "undefined") return null;
	return readStoredToken();
}

export function setAuthToken(token: string): void {
	const trimmed = token.trim();
	memoryToken = trimmed === "" ? null : trimmed;
	try {
		if (trimmed === "") window.localStorage?.removeItem(STORAGE_KEY);
		else window.localStorage?.setItem(STORAGE_KEY, trimmed);
	} catch {
		// Storage can be unavailable even when window exists.
	}
	notify();
}

export function clearAuthToken(): void {
	setAuthToken("");
}

export function useAuthToken(): string | null {
	return useSyncExternalStore(
		(subscribe) => {
			listeners.add(subscribe);
			return () => {
				listeners.delete(subscribe);
			};
		},
		readStoredToken,
		() => null,
	);
}
