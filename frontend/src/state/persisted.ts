import {
	createJSONStorage,
	type PersistStorage,
	type StateStorage,
} from "zustand/middleware";

export const THEME_STORAGE_KEY = "waypoint-theme";
export const UI_PREFS_STORAGE_KEY = "waypoint.ui-prefs.v1";
export const TIMING_STORAGE_KEY = "nwe.card-cycle.v4";
export const TIMING_LEGACY_KEYS = ["nwe.card-cycle.v3", "nwe.card-cycle.v2"];

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

/**
 * Wrap a JSON persist storage with legacy-key fallback. When the primary
 * key holds nothing readable, each legacy key is tried in order. The first
 * readable value wins. Writes always target the primary key.
 */
export function withLegacyKeys<T>(
	storage: PersistStorage<T> | undefined,
	legacyKeys: string[],
): PersistStorage<T> | undefined {
	if (!storage) return undefined;
	return {
		getItem: async (name) => {
			const primary = await storage.getItem(name);
			if (primary !== null) return primary;
			for (const key of legacyKeys) {
				try {
					const raw = (await appLocalStorage.getItem(key)) as string | null;
					if (raw === null) continue;
					const parsed = JSON.parse(raw) as unknown;
					if (parsed !== null && typeof parsed === "object") {
						return { state: parsed as T, version: 0 };
					}
				} catch {
					continue;
				}
			}
			return null;
		},
		setItem: (name, value) => storage.setItem(name, value),
		removeItem: (name) => storage.removeItem(name),
	};
}
