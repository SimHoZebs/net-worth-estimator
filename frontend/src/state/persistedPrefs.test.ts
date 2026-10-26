import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClient, ApiHttpError } from "../api/client.ts";
import { useNotifications } from "./notifications.ts";
import type { SafeSpendingSettings } from "../api/contracts.ts";
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
	defaultSafeSpendingSettings,
	hydrateFinancialPreferences,
	refreshSafeSpendingSettings,
} from "./useSafeSpendingSettings.ts";
import { safeSpendingSettingsObserver as useSafeSpendingSettings } from "../test/safeSpendingSettings.ts";

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

function acceptOwner(id: string = A, apiBaseUrl = canonicalApiBaseUrl("")) {
	const scope = acceptResourceScope(
		{
			apiBaseUrl,
			resource: {
				id,
				kind: id === "plans/sample" ? "sample" : "private",
				permissions: ["plan:read", "plan:write"],
			},
			subject: id !== "plans/sample" ? id : null,
		},
		suspendResourceScope(),
	);
	if (!scope) throw new Error("The fixture scope could not be verified.");
	return scope;
}

async function verifyOwner(
	id: string = A,
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
	const backend = new Map<string, SafeSpendingSettings>();
	const key = () =>
		`${getResourceScope().apiBaseUrl}:${getResourceScope().resource?.id}`;
	vi.spyOn(ApiClient.prototype, "getSafeSpendingSettings").mockImplementation(
		async () => ({ settings: backend.get(key()) ?? null }),
	);
	vi.spyOn(ApiClient.prototype, "setSafeSpendingSettings").mockImplementation(
		async (settings) => {
			backend.set(key(), structuredClone(settings));
			return { settings };
		},
	);
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
	it("keeps the browser import for later when the server is read-only", async () => {
		window.localStorage.setItem(
			financialKey(),
			JSON.stringify({ reserve: 999 }),
		);
		vi.mocked(ApiClient.prototype.setSafeSpendingSettings).mockResolvedValue(
			new ApiHttpError({ status: 403, message: "Read-only" }),
		);
		await verifyOwner();
		expect(useSafeSpendingSettings.getState().reserve).toBe(
			defaultSafeSpendingSettings().reserve,
		);
		expect(window.localStorage.getItem(financialKey())).toContain("999");
	});

	it("reports a failed save and retries the latest settings", async () => {
		const save = vi.mocked(ApiClient.prototype.setSafeSpendingSettings);
		save.mockResolvedValueOnce(new Error("Offline"));
		useSafeSpendingSettings.getState().updateSettings({ reserve: 123 });
		await vi.waitFor(() =>
			expect(useNotifications.getState().items[0]?.message).toContain(
				"not saved",
			),
		);
		useNotifications.getState().items[0]?.action?.onAction();
		await vi.waitFor(() =>
			expect(useNotifications.getState().items).toHaveLength(0),
		);
		expect(save.mock.lastCall?.[0].reserve).toBe(123);
	});
	it("prefers backend settings over an old browser record", async () => {
		window.localStorage.setItem(
			financialKey(),
			JSON.stringify({ reserve: 999 }),
		);
		vi.mocked(ApiClient.prototype.getSafeSpendingSettings).mockResolvedValue({
			settings: { ...defaultSafeSpendingSettings(), reserve: 123 },
		});
		await refreshSafeSpendingSettings();
		expect(useSafeSpendingSettings.getState().reserve).toBe(123);
		expect(ApiClient.prototype.setSafeSpendingSettings).not.toHaveBeenCalled();
	});

	it("does not mount financial preferences when the backend read fails", async () => {
		vi.mocked(ApiClient.prototype.getSafeSpendingSettings).mockResolvedValue(
			new Error("Settings unavailable"),
		);
		const scope = acceptOwner(B);
		await expect(hydrateFinancialPreferences(scope)).rejects.toThrow(
			"Settings unavailable",
		);
		useSafeSpendingSettings.getState().updateSettings({ reserve: 999 });
		expect(useSafeSpendingSettings.getState().reserve).toBe(
			defaultSafeSpendingSettings().reserve,
		);
		expect(ApiClient.prototype.setSafeSpendingSettings).not.toHaveBeenCalled();
	});

	it("serializes rapid edits and stores them only in the backend", async () => {
		useSafeSpendingSettings.getState().updateSettings({ reserve: 123 });
		useSafeSpendingSettings.getState().updateSettings({ reserve: 456 });
		await refreshSafeSpendingSettings();
		expect(
			vi
				.mocked(ApiClient.prototype.setSafeSpendingSettings)
				.mock.calls.map(([settings]) => settings.reserve),
		).toEqual([123, 456]);
		expect(useSafeSpendingSettings.getState().reserve).toBe(456);
		expect(window.localStorage.getItem(financialKey())).toBeNull();
	});
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
		await refreshSafeSpendingSettings();
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
		await refreshSafeSpendingSettings();
		expect(useSafeSpendingSettings.getState().incomeRuleIds).toEqual([
			"salary",
			"partner",
		]);
		useSafeSpendingSettings.getState().updateSettings({ incomeRuleIds: [] });
		await refreshSafeSpendingSettings();
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
		await refreshSafeSpendingSettings();
		const state = useSafeSpendingSettings.getState();
		expect(state.reserve).toBe(100);
		expect(state.incomeRuleIds).toEqual(["salary"]);
		expect(state.movementIds).toEqual(["rent"]);
		for (const key of Object.keys(overrides))
			expect(state).not.toHaveProperty(key);
		state.updateSettings({ reserve: 200 });
		expect(window.localStorage.getItem(financialKey())).toBeNull();
		await refreshSafeSpendingSettings();
		expect(
			vi.mocked(ApiClient.prototype.setSafeSpendingSettings).mock.lastCall?.[0],
		).not.toHaveProperty("checkingOverride");
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
		await refreshSafeSpendingSettings();
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
		await refreshSafeSpendingSettings();
		await verifyOwner("plans/sample");
		expect(useSafeSpendingSettings.getState()).toMatchObject(
			defaultSafeSpendingSettings(),
		);
		useSafeSpendingSettings
			.getState()
			.updateSettings({ reserve: 42, incomeRuleIds: ["sample-income"] });
		await refreshSafeSpendingSettings();
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
		await refreshSafeSpendingSettings();
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
		for (const id of [A, B, "plans/sample"]) {
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

	it("isolates the sample and API origins without changing global display preferences", async () => {
		useThemeStore.getState().setPreference("dark");
		useUiStore.getState().setYears(30);
		useUiStore.getState().setRanges(false);
		useSafeSpendingSettings.getState().updateSettings({ reserve: 100 });
		await refreshSafeSpendingSettings();
		await verifyOwner(A, "https://different-api.example");
		expect(useSafeSpendingSettings.getState().reserve).toBe(
			defaultSafeSpendingSettings().reserve,
		);
		await verifyOwner("plans/sample");
		useSafeSpendingSettings
			.getState()
			.updateSettings({ reserve: 200, incomeRuleIds: ["sample-income"] });
		await refreshSafeSpendingSettings();
		await verifyOwner(A);
		expect(useSafeSpendingSettings.getState().reserve).toBe(100);
		await verifyOwner("plans/sample");
		expect(useSafeSpendingSettings.getState()).toMatchObject({
			reserve: 200,
			incomeRuleIds: ["sample-income"],
		});
		suspendResourceScope();
		expect(useThemeStore.getState().preference).toBe("dark");
		expect(useUiStore.getState()).toMatchObject({ years: 30, ranges: false });
		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toContain("dark");
		expect(window.localStorage.getItem(UI_PREFS_STORAGE_KEY)).toContain(
			'"years":30',
		);
	});

	it("uses the backend when browser storage is blocked", async () => {
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
		await refreshSafeSpendingSettings();
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
		expect(window.localStorage.getItem(financialKey())).toBeNull();
	});
});
