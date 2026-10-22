import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	acceptResourceScope,
	canonicalApiBaseUrl,
	getResourceScope,
	resourceStorageKey,
	suspendResourceScope,
} from "../auth/resourceScope.ts";
import {
	THEME_STORAGE_KEY,
	SAFE_SPENDING_STORAGE_KEY,
	UI_PREFS_STORAGE_KEY,
	SAFE_SPENDING_LEGACY_KEYS,
	appLocalStorage,
	clearPersistedMemory,
	resourceLocalStorage,
} from "./persisted.ts";
import { resetUiStore, useUiStore } from "./uiStore.ts";
import { useThemeStore } from "./useTheme.ts";
import {
	resetSafeSpendingSettings,
	sanitizeSafeSpendingSettings,
	useSafeSpendingSettings,
	defaultSafeSpendingSettings,
	hydrateFinancialPreferences,
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

const A = `plans/${"a".repeat(64)}`;
const B = `plans/${"b".repeat(64)}`;

function acceptOwner(
	id: string | null = A,
	apiBaseUrl = canonicalApiBaseUrl(""),
) {
	const scope = acceptResourceScope(
		{
			apiBaseUrl,
			resource: id
				? {
						id,
						kind: id === "plans/sample" ? "sample" : "private",
						permissions: ["plan:read"],
					}
				: null,
			subject: id && id !== "plans/sample" ? id : null,
		},
		suspendResourceScope(),
	);
	if (!scope) throw new Error("The fixture scope could not be verified.");
	return scope;
}

async function verifyOwner(
	id: string | null = A,
	apiBaseUrl = canonicalApiBaseUrl(""),
) {
	const scope = acceptOwner(id, apiBaseUrl);
	expect(await hydrateFinancialPreferences(scope)).toBe(true);
	return scope;
}

function financialKey(scope = getResourceScope()) {
	const key = resourceStorageKey(SAFE_SPENDING_STORAGE_KEY, scope);
	if (!key) throw new Error("A verified fixture resource is required.");
	return key;
}

beforeEach(async () => {
	vi.unstubAllGlobals();
	suspendResourceScope();
	stubStorage(memoryStorage());
	clearPersistedMemory();
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
	await verifyOwner();
});

afterEach(() => {
	suspendResourceScope();
	clearPersistedMemory();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("unified persisted prefs", () => {
	it("persists only UI years/ranges, without credential fields", async () => {
		useUiStore.getState().setYears(10);
		useUiStore.getState().setRanges(false);
		// Persist writes are async-adjacent; flush a tick.
		await new Promise((resolve) => setTimeout(resolve, 0));
		const raw = window.localStorage.getItem(UI_PREFS_STORAGE_KEY) ?? "";
		expect(raw).toContain('"years":10');
		expect(raw).toContain('"ranges":false');
		expect(raw).not.toMatch(/authToken|bearerToken/);
		expect(useUiStore.getState()).not.toHaveProperty("authToken");
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

	it("reads raw financial settings only from the current resource namespace", async () => {
		window.localStorage.setItem(
			financialKey(),
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
			financialKey(),
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
		expect(window.localStorage.getItem(financialKey())).not.toContain(
			"Override",
		);
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

describe("financial preference owner isolation", () => {
	it("keeps every financial amount, date, and selected resource ID isolated across accounts and sample data", async () => {
		const settingsA = {
			statementDay: 8,
			statementDaySet: true,
			reserve: 12345,
			accountIds: ["private-a-card"],
			spendingAccountIds: ["private-a-cash"],
			incomeRuleIds: ["private-a-income", "private-a-partner"],
			movementIds: ["private-a-bill"],
		};
		useSafeSpendingSettings.getState().updateSettings(settingsA);
		await verifyOwner(B);
		expect(useSafeSpendingSettings.getState()).toMatchObject(
			defaultSafeSpendingSettings(),
		);
		const settingsB = {
			statementDay: 16,
			statementDaySet: true,
			reserve: 678,
			accountIds: ["private-b-card"],
			spendingAccountIds: ["private-b-cash"],
			incomeRuleIds: [],
			movementIds: ["private-b-bill"],
		};
		useSafeSpendingSettings.getState().updateSettings(settingsB);
		await verifyOwner("plans/sample");
		expect(useSafeSpendingSettings.getState()).toMatchObject(
			defaultSafeSpendingSettings(),
		);
		useSafeSpendingSettings
			.getState()
			.updateSettings({ reserve: 42, incomeRuleIds: ["sample-income"] });
		await verifyOwner(A);
		expect(useSafeSpendingSettings.getState()).toMatchObject(settingsA);
		await verifyOwner(B);
		expect(useSafeSpendingSettings.getState()).toMatchObject(settingsB);
		await verifyOwner("plans/sample");
		expect(useSafeSpendingSettings.getState()).toMatchObject({
			reserve: 42,
			incomeRuleIds: ["sample-income"],
		});
	});

	it("resets synchronously during verification and rejects stale actions without overwriting saved preferences", async () => {
		const oldAction = useSafeSpendingSettings.getState().updateSettings;
		oldAction({ reserve: 123, incomeRuleIds: ["private-a-income"] });
		const keyA = financialKey();
		const rawA = window.localStorage.getItem(keyA);
		suspendResourceScope();
		expect(useSafeSpendingSettings.getState()).toMatchObject(
			defaultSafeSpendingSettings(),
		);
		oldAction({ reserve: 999, accountIds: ["stale-a-card"] });
		useSafeSpendingSettings.getState().updateSettings({ reserve: 555 });
		expect(useSafeSpendingSettings.getState()).toMatchObject(
			defaultSafeSpendingSettings(),
		);
		expect(window.localStorage.getItem(keyA)).toBe(rawA);
		await verifyOwner(B);
		oldAction({ reserve: 999, incomeRuleIds: ["stale-a-income"] });
		expect(useSafeSpendingSettings.getState()).toMatchObject(
			defaultSafeSpendingSettings(),
		);
		await verifyOwner(A);
		expect(useSafeSpendingSettings.getState()).toMatchObject({
			reserve: 123,
			incomeRuleIds: ["private-a-income"],
		});
		expect(window.localStorage.getItem(keyA)).toBe(rawA);
	});

	it("never reads, migrates, or overwrites unscoped financial preferences, including in legacy mode", async () => {
		const keys = [SAFE_SPENDING_STORAGE_KEY, ...SAFE_SPENDING_LEGACY_KEYS];
		const raw = JSON.stringify({
			statementDay: 7,
			reserve: 98765,
			incomeRuleIds: ["unscoped-private-income"],
			spendingAccountIds: ["unscoped-private-cash"],
		});
		for (const key of keys) window.localStorage.setItem(key, raw);
		const read = vi.spyOn(window.localStorage, "getItem");
		for (const id of [A, B, "plans/sample", null]) {
			await verifyOwner(id);
			expect(useSafeSpendingSettings.getState()).toMatchObject(
				defaultSafeSpendingSettings(),
			);
			useSafeSpendingSettings.getState().updateSettings({ reserve: 9 });
		}
		for (const key of keys) expect(read).not.toHaveBeenCalledWith(key);
		read.mockRestore();
		for (const key of keys) expect(window.localStorage.getItem(key)).toBe(raw);
	});

	it("isolates legacy deployments and API origins without changing global display preferences", async () => {
		useThemeStore.getState().setPreference("dark");
		useUiStore.getState().setYears(30);
		useUiStore.getState().setRanges(false);
		useSafeSpendingSettings.getState().updateSettings({ reserve: 100 });
		await verifyOwner(A, "https://different-api.example");
		expect(useSafeSpendingSettings.getState().reserve).toBe(
			defaultSafeSpendingSettings().reserve,
		);
		await verifyOwner(null);
		useSafeSpendingSettings
			.getState()
			.updateSettings({ reserve: 200, incomeRuleIds: ["legacy-income"] });
		await verifyOwner(A);
		expect(useSafeSpendingSettings.getState().reserve).toBe(100);
		await verifyOwner(null);
		expect(useSafeSpendingSettings.getState()).toMatchObject({
			reserve: 200,
			incomeRuleIds: ["legacy-income"],
		});
		suspendResourceScope();
		expect(useThemeStore.getState().preference).toBe("dark");
		expect(useUiStore.getState()).toMatchObject({ years: 30, ranges: false });
		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toContain("dark");
		expect(window.localStorage.getItem(UI_PREFS_STORAGE_KEY)).toContain(
			'"years":30',
		);
	});

	it("keeps memory fallbacks scoped when browser storage is blocked", async () => {
		stubStorage({
			...memoryStorage(),
			getItem: () => {
				throw new Error("Blocked");
			},
			setItem: () => {
				throw new Error("Blocked");
			},
		});
		await verifyOwner(A);
		useSafeSpendingSettings
			.getState()
			.updateSettings({ reserve: 111, movementIds: ["private-a-bill"] });
		await verifyOwner(B);
		expect(useSafeSpendingSettings.getState()).toMatchObject(
			defaultSafeSpendingSettings(),
		);
		useSafeSpendingSettings.getState().updateSettings({ reserve: 222 });
		await verifyOwner(A);
		expect(useSafeSpendingSettings.getState()).toMatchObject({
			reserve: 111,
			movementIds: ["private-a-bill"],
		});
	});

	it("rejects writes through a captured storage owner after verification changes", async () => {
		const oldScope = getResourceScope();
		const oldStorage = resourceLocalStorage(oldScope);
		const oldKey = financialKey();
		await verifyOwner(B);
		oldStorage.setItem(SAFE_SPENDING_STORAGE_KEY, "private-a-stale-write");
		expect(oldStorage.getItem(SAFE_SPENDING_STORAGE_KEY)).toBeNull();
		expect(window.localStorage.getItem(oldKey)).toBeNull();
		expect(window.localStorage.getItem(financialKey())).toBeNull();
	});

	it("ignores a late asynchronous hydration after a newer owner completes", async () => {
		const keyA = financialKey();
		let finish: (value: string) => void = () => {};
		const getItem = appLocalStorage.getItem;
		vi.spyOn(appLocalStorage, "getItem").mockImplementation((key) =>
			key === keyA
				? new Promise<string>((resolve) => {
						finish = resolve;
					})
				: getItem(key),
		);
		const oldScope = acceptOwner(A);
		const oldHydration = hydrateFinancialPreferences(oldScope);
		expect(useSafeSpendingSettings.getState()).toMatchObject(
			defaultSafeSpendingSettings(),
		);
		await verifyOwner(B);
		useSafeSpendingSettings
			.getState()
			.updateSettings({ reserve: 222, incomeRuleIds: ["private-b-income"] });
		finish(
			JSON.stringify({
				state: { reserve: 999, incomeRuleIds: ["late-private-a-income"] },
				version: 4,
			}),
		);
		expect(await oldHydration).toBe(false);
		expect(useSafeSpendingSettings.getState()).toMatchObject({
			reserve: 222,
			incomeRuleIds: ["private-b-income"],
		});
		expect(window.localStorage.getItem(financialKey())).not.toContain(
			"late-private-a",
		);
	});
});
