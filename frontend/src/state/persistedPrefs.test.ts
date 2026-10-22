import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	THEME_STORAGE_KEY,
	SAFE_SPENDING_STORAGE_KEY,
	UI_PREFS_STORAGE_KEY,
} from "./persisted.ts";
import { resetUiStore, useUiStore } from "./uiStore.ts";
import { useThemeStore } from "./useTheme.ts";
import {
	resetSafeSpendingSettings,
	sanitizeSafeSpendingSettings,
	useSafeSpendingSettings,
} from "./useSafeSpendingSettings.ts";

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
	resetSafeSpendingSettings();
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

	it("migrates legacy raw safe spending settings", async () => {
		window.localStorage.setItem(
			SAFE_SPENDING_STORAGE_KEY,
			JSON.stringify({
				statementDay: 5,
				reserve: 100,
				mandatoryFrame: "cycle",
			}),
		);
		await useSafeSpendingSettings.persist.rehydrate();
		const state = useSafeSpendingSettings.getState();
		expect(state.statementDay).toBe(5);
		expect(state.reserve).toBe(100);
		expect(state.incomeRuleIds).toEqual([]);
		expect(state).not.toHaveProperty("mandatoryFrame");
	});

	it("persists explicit income sources and an empty selection across reloads", async () => {
		useSafeSpendingSettings
			.getState()
			.updateSettings({ incomeRuleIds: ["salary", "partner"] });
		await useSafeSpendingSettings.persist.rehydrate();
		expect(useSafeSpendingSettings.getState().incomeRuleIds).toEqual([
			"salary",
			"partner",
		]);
		useSafeSpendingSettings.getState().updateSettings({ incomeRuleIds: [] });
		await useSafeSpendingSettings.persist.rehydrate();
		expect(useSafeSpendingSettings.getState().incomeRuleIds).toEqual([]);
	});

	it("discards legacy amount overrides and preserves source settings", async () => {
		const overrides = {
			checkingOverride: 10000,
			remainingOverride: 20000,
			paycheckOverride: 30000,
			fixedOverride: 40000,
			spentOverride: 50000,
		};
		window.localStorage.setItem(
			SAFE_SPENDING_STORAGE_KEY,
			JSON.stringify({
				state: {
					...overrides,
					reserve: 100,
					incomeRuleIds: ["salary"],
					movementIds: ["rent"],
				},
				version: 4,
			}),
		);
		await useSafeSpendingSettings.persist.rehydrate();
		const state = useSafeSpendingSettings.getState();
		expect(state.reserve).toBe(100);
		expect(state.incomeRuleIds).toEqual(["salary"]);
		expect(state.movementIds).toEqual(["rent"]);
		for (const key of Object.keys(overrides))
			expect(state).not.toHaveProperty(key);
		state.updateSettings({ reserve: 200 });
		expect(
			window.localStorage.getItem(SAFE_SPENDING_STORAGE_KEY),
		).not.toContain("Override");
	});

	it("sanitizes income rule IDs without an automatic fallback", () => {
		expect(
			sanitizeSafeSpendingSettings({
				incomeRuleIds: ["salary", 123, "", "salary", "partner"],
			}).incomeRuleIds,
		).toEqual(["salary", "partner"]);
		for (const incomeRuleIds of [null, undefined, [], "salary", [123]]) {
			expect(
				sanitizeSafeSpendingSettings({ incomeRuleIds }).incomeRuleIds,
			).toEqual([]);
		}
	});

	it("sanitizes safe spending settings with legacy 1st-day fallback", () => {
		expect(
			sanitizeSafeSpendingSettings({ statementDay: 1, reserve: -5 })
				.statementDay,
		).toBe(20);
		expect(
			sanitizeSafeSpendingSettings({ statementDay: 99, reserve: 50 })
				.statementDay,
		).toBe(28);
		expect(sanitizeSafeSpendingSettings(null).reserve).toBeGreaterThanOrEqual(
			0,
		);
	});
});
