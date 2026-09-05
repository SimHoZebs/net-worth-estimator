import { useSyncExternalStore } from "react";

const STORAGE_KEY = "net-worth-estimator:auth-token";

const listeners = new Set<() => void>();

function notify() {
	for (const listener of listeners) listener();
}

function readStoredToken(): string | null {
	try {
		return window.localStorage?.getItem(STORAGE_KEY) ?? null;
	} catch {
		return null;
	}
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
	try {
		if (token.trim() === "") window.localStorage?.removeItem(STORAGE_KEY);
		else window.localStorage?.setItem(STORAGE_KEY, token.trim());
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
