import { vi } from "vitest";

/** In-memory Storage with inspectable values for unit tests. */
export function memoryStorage(): Storage & { values: Map<string, string> } {
	const values = new Map<string, string>();
	return {
		values,
		get length() {
			return values.size;
		},
		key: (index) => [...values.keys()][index] ?? null,
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value);
		},
		removeItem: (key) => {
			values.delete(key);
		},
		clear: () => values.clear(),
	};
}

/** Point both the global and window localStorage at the given store. */
export function stubStorage(storage: Storage) {
	vi.stubGlobal("localStorage", storage);
	// appLocalStorage reads window.localStorage; keep both in sync in jsdom.
	try {
		Object.defineProperty(window, "localStorage", {
			value: storage,
			configurable: true,
			writable: true,
		});
	} catch {
		// Ignore when window is unavailable.
	}
}
