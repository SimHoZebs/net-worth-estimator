import { createJSONStorage, type StateStorage } from "zustand/middleware";

export const THEME_STORAGE_KEY = "waypoint-theme";
export const UI_PREFS_STORAGE_KEY = "waypoint.ui-prefs.v1";

const memory = new Map<string, string>();

function hasBrowserStorage(): boolean {
	try {
		return (
			typeof window !== "undefined" &&
			typeof window.localStorage !== "undefined" &&
			window.localStorage !== null
		);
	} catch {
		return false;
	}
}

/**
 * Single localStorage entry point for lightweight UI prefs.
 * Falls back to process memory when browser storage is unavailable
 * (SSR, private mode, tests without a stub) so stores stay usable.
 */
export const appLocalStorage: StateStorage = {
	getItem: (name) => {
		try {
			if (hasBrowserStorage()) return window.localStorage.getItem(name);
		} catch {
			// Fall through to memory.
		}
		return memory.get(name) ?? null;
	},
	setItem: (name, value) => {
		try {
			if (hasBrowserStorage()) {
				window.localStorage.setItem(name, value);
				return;
			}
		} catch {
			// Storage full or blocked: keep memory copy only.
		}
		memory.set(name, value);
	},
	removeItem: (name) => {
		try {
			if (hasBrowserStorage()) window.localStorage.removeItem(name);
		} catch {
			// Ignore removal failures.
		}
		memory.delete(name);
	},
};

/** Test hook: clears the memory fallback between cases. */
export function clearPersistedMemory(): void {
	memory.clear();
}

export function appJsonStorage<T>() {
	return createJSONStorage<T>(() => appLocalStorage);
}
