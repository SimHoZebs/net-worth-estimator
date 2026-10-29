import {
	createJSONStorage,
	type PersistStorage,
	type StateStorage,
} from "zustand/middleware";
import {
	getUserScope,
	userStorageKey,
	type UserScope,
} from "../auth/resourceScope.ts";

export const THEME_STORAGE_KEY = "waypoint-theme";
export const UI_PREFS_STORAGE_KEY = "waypoint.ui-prefs.v1";
export const SAFE_SPENDING_STORAGE_KEY = "nwe.safe-spending.v1";
export const SAFE_SPENDING_LEGACY_KEYS = [
	"nwe.card-cycle.v4",
	"nwe.card-cycle.v3",
	"nwe.card-cycle.v2",
];

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
 * One-time upgrade path for browser records written before the user
 * cutover. Current keys use `:user:` plus `users/*` ids. On a primary miss
 * the `:account:` plus `accounts/*` generation is tried first, then the
 * `:resource:` plus `plans/*` generation; the first hit is copied forward
 * and deleted. Nothing writes legacy keys.
 */
function legacyKeysFor(name: string, scope: UserScope): string[] {
	const primary = userStorageKey(name, scope);
	if (!primary) return [];
	const accountGeneration = primary
		.replace(":user:", ":account:")
		.replaceAll("users%2F", "accounts%2F");
	const resourceGeneration = primary
		.replace(":user:", ":resource:")
		.replaceAll("users%2F", "plans%2F");
	const keys = [accountGeneration, resourceGeneration];
	return keys.filter((key) => key !== primary);
}

/** Financial preferences bind to one verified user, including memory fallbacks. */
export function accountLocalStorage(scope: UserScope): StateStorage {
	const keyFor = (name: string) =>
		scope === getUserScope() ? userStorageKey(name, scope) : null;
	const readThrough = (name: string): string | null => {
		const key = keyFor(name);
		if (!key) return null;
		try {
			const raw = appLocalStorage.getItem(key);
			if (raw instanceof Promise) return null;
			if (raw !== null) return raw;
			for (const legacy of legacyKeysFor(name, scope)) {
				const migrated = appLocalStorage.getItem(legacy);
				if (migrated === null || migrated instanceof Promise) continue;
				appLocalStorage.setItem(key, migrated);
				appLocalStorage.removeItem(legacy);
				return migrated;
			}
			return null;
		} catch {
			return null;
		}
	};
	return {
		getItem: (name) => (keyFor(name) ? readThrough(name) : null),
		setItem: (name, value) => {
			const key = keyFor(name);
			if (key) return appLocalStorage.setItem(key, value);
		},
		removeItem: (name) => {
			const key = keyFor(name);
			if (key) appLocalStorage.removeItem(key);
			for (const legacy of legacyKeysFor(name, scope))
				appLocalStorage.removeItem(legacy);
		},
	};
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
