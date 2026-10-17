import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	THEME_STORAGE_KEY,
	TIMING_STORAGE_KEY,
	UI_PREFS_STORAGE_KEY,
} from "./persisted.ts";
import { resetUiStore, useUiStore } from "./uiStore.ts";
import { useThemeStore } from "./useTheme.ts";
import {
	resetTimingSettings,
	sanitizeTimingSettings,
	useTimingSettings,
} from "./useTimingSettings.ts";

function memoryStorage(): Storage {
	const values = new Map<string, string>();
	return {
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

function stubStorage(storage: Storage) {
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

beforeEach(() => {
	vi.unstubAllGlobals();
	stubStorage(memoryStorage());
	useUiStore.persist.setOptions({
		name: UI_PREFS_STORAGE_KEY,
	});
	resetUiStore();
	useThemeStore.setState({ preference: "system" });
	resetTimingSettings();
	try {
		window.localStorage.clear();
	} catch {
		// Ignore.
	}
});

describe("unified persisted prefs", () => {
	it("persists UI years/ranges without auth token", async () => {
		useUiStore.getState().setYears(10);
		useUiStore.getState().setRanges(false);
		useUiStore.getState().setAuthToken("secret");
		// Persist writes are async-adjacent; flush a tick.
		await new Promise((resolve) => setTimeout(resolve, 0));
		const raw = window.localStorage.getItem(UI_PREFS_STORAGE_KEY) ?? "";
		expect(raw).toContain('"years":10');
		expect(raw).toContain('"ranges":false');
		expect(raw).not.toContain("secret");
	});

	it("falls back to UI defaults on corrupt prefs", async () => {
		window.localStorage.setItem(UI_PREFS_STORAGE_KEY, "{bad");
		await useUiStore.persist.rehydrate();
		expect(useUiStore.getState().years).toBe(20);
		expect(useUiStore.getState().ranges).toBe(true);
	});

	it("reads legacy plain-string theme and envelope", async () => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
		await useThemeStore.persist.rehydrate();
		expect(useThemeStore.getState().preference).toBe("dark");

		window.localStorage.setItem(
			THEME_STORAGE_KEY,
			JSON.stringify({ state: { preference: "light" }, version: 1 }),
		);
		await useThemeStore.persist.rehydrate();
		expect(useThemeStore.getState().preference).toBe("light");
	});

	it("migrates legacy raw timing settings", async () => {
		window.localStorage.setItem(
			TIMING_STORAGE_KEY,
			JSON.stringify({
				statementDay: 5,
				reserve: 100,
				mandatoryFrame: "cycle",
			}),
		);
		await useTimingSettings.persist.rehydrate();
		const state = useTimingSettings.getState();
		expect(state.statementDay).toBe(5);
		expect(state.reserve).toBe(100);
		expect(state.mandatoryFrame).toBe("cycle");
	});

	it("sanitizes timing settings with legacy 1st-day fallback", () => {
		expect(
			sanitizeTimingSettings({ statementDay: 1, reserve: -5 }).statementDay,
		).toBe(20);
		expect(
			sanitizeTimingSettings({ statementDay: 99, reserve: 50 }).statementDay,
		).toBe(28);
		expect(sanitizeTimingSettings(null).reserve).toBeGreaterThanOrEqual(0);
	});
});
