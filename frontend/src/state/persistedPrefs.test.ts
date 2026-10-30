import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiNetworkError } from "../api/http.ts";
import { useNotifications } from "./notifications.ts";
import type { SafeSpendingSettings } from "../api/contracts.ts";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	getUserScope,
	userStorageKey,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import {
	THEME_STORAGE_KEY,
	SAFE_SPENDING_STORAGE_KEY,
	UI_PREFS_STORAGE_KEY,
	SAFE_SPENDING_LEGACY_KEYS,
	appLocalStorage,
	clearPersistedMemory,
	accountLocalStorage,
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
import { safeSpendingSettingsObserver as useSafeSpendingSettings } from "../mocks/safeSpendingSettings.ts";
import { memoryStorage, stubStorage } from "../mocks/storage.ts";
import { GUEST_USER_ID, GUEST_USER_SUBJECT } from "../mocks/resource.ts";

const A = `users/${"a".repeat(64)}`;
const B = `users/${"b".repeat(64)}`;

function acceptOwner(id: string = A, apiBaseUrl = canonicalApiBaseUrl("")) {
	const scope = acceptUserScope(
		{
			apiBaseUrl,
			resource: {
				id,
				permissions: ["user:read", "user:write"],
			},
			subject: id === GUEST_USER_ID ? GUEST_USER_SUBJECT : id,
		},
		suspendUserScope(),
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

function financialKey(scope = getUserScope()) {
	const key = userStorageKey(SAFE_SPENDING_STORAGE_KEY, scope);
	if (!key) throw new Error("A verified fixture resource is required.");
	return key;
}

function ok(body: unknown, resource: string | null = A) {
	const headers = new Headers({ "content-type": "application/json" });
	if (resource) headers.set("Waypoint-Resource", resource);
	return new Response(JSON.stringify(body), { headers });
}

function err(status: number, resource: string | null = A) {
	return new Response(JSON.stringify({ title: "Server error" }), {
		status,
		headers: {
			"content-type": "application/json",
			...(resource ? { "Waypoint-Resource": resource } : {}),
		},
	});
}

const server = {
	backend: new Map<string, SafeSpendingSettings>(),
	putStatus: 0,
	putErrors: [] as Error[],
	getError: null as Error | null,
	puts: [] as unknown[],
};

function backendKey() {
	return `${getUserScope().apiBaseUrl}:${getUserScope().resource?.id}`;
}

function stubSettingsFetch() {
	const resource = () => getUserScope().resource?.id ?? null;
	return vi.fn(async (url: unknown, init?: RequestInit) => {
		if (!String(url).endsWith("/v1/safe-spending-settings"))
			return ok({}, resource());
		if ((init?.method ?? "GET") !== "GET") {
			server.puts.push(JSON.parse(String(init?.body ?? "{}")));
			const failure = server.putErrors.shift();
			if (failure) throw failure;
			if (server.putStatus) return err(server.putStatus, resource());
			const body = JSON.parse(String(init?.body ?? "{}"));
			server.backend.set(backendKey(), body);
			return ok({ settings: body }, resource());
		}
		if (server.getError) throw server.getError;
		return ok(
			{ settings: server.backend.get(backendKey()) ?? null },
			resource(),
		);
	});
}

beforeEach(async () => {
	vi.unstubAllGlobals();
	suspendUserScope();
	stubStorage(memoryStorage());
	clearPersistedMemory();
	useUiStore.persist.setOptions({
		name: UI_PREFS_STORAGE_KEY,
	});
	resetUiStore();
	useThemeStore.setState({ preference: "system" });
	resetSafeSpendingSettings();
	server.backend.clear();
	server.putStatus = 0;
	server.putErrors = [];
	server.getError = null;
	server.puts = [];
	vi.stubGlobal("fetch", stubSettingsFetch());
	try {
		window.localStorage.clear();
	} catch {
		// Ignore.
	}
	await verifyOwner();
});

afterEach(() => {
	suspendUserScope();
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
		server.putStatus = 403;
		await verifyOwner();
		expect(useSafeSpendingSettings.getState().reserve).toBe(
			defaultSafeSpendingSettings().reserve,
		);
		expect(window.localStorage.getItem(financialKey())).toContain("999");
	});

	it("migrates a private-kind browser record forward once, then drops it", async () => {
		const scope = getUserScope();
		const primary = financialKey(scope);
		const legacy = primary.replace(
			`:${encodeURIComponent(scope.apiBaseUrl)}:`,
			`:${encodeURIComponent(scope.apiBaseUrl)}:private:`,
		);
		expect(legacy).not.toBe(primary);
		expect(legacy).toContain(":private:");
		window.localStorage.setItem(legacy, JSON.stringify({ reserve: 999 }));
		const storage = accountLocalStorage(scope);
		expect(await storage.getItem(SAFE_SPENDING_STORAGE_KEY)).toBe(
			JSON.stringify({ reserve: 999 }),
		);
		expect(window.localStorage.getItem(primary)).toBe(
			JSON.stringify({ reserve: 999 }),
		);
		expect(window.localStorage.getItem(legacy)).toBeNull();
	});

	it("migrates an account-generation browser record forward once, then drops it", async () => {
		const scope = getUserScope();
		const primary = financialKey(scope);
		const legacy = primary
			.replace(":user:", ":account:")
			.replaceAll("users%2F", "accounts%2F");
		expect(legacy).not.toBe(primary);
		expect(legacy).toContain(":account:");
		expect(legacy).toContain("accounts%2F");
		window.localStorage.setItem(legacy, JSON.stringify({ reserve: 999 }));
		const storage = accountLocalStorage(scope);
		expect(await storage.getItem(SAFE_SPENDING_STORAGE_KEY)).toBe(
			JSON.stringify({ reserve: 999 }),
		);
		expect(window.localStorage.getItem(primary)).toBe(
			JSON.stringify({ reserve: 999 }),
		);
		expect(window.localStorage.getItem(legacy)).toBeNull();
	});

	it("migrates a resource-generation browser record forward once, then drops it", async () => {
		const scope = getUserScope();
		const primary = financialKey(scope);
		const legacy = primary
			.replace(":user:", ":resource:")
			.replaceAll("users%2F", "plans%2F");
		expect(legacy).not.toBe(primary);
		expect(legacy).toContain(":resource:");
		expect(legacy).toContain("plans%2F");
		window.localStorage.setItem(legacy, JSON.stringify({ reserve: 999 }));
		const storage = accountLocalStorage(scope);
		expect(await storage.getItem(SAFE_SPENDING_STORAGE_KEY)).toBe(
			JSON.stringify({ reserve: 999 }),
		);
		expect(window.localStorage.getItem(primary)).toBe(
			JSON.stringify({ reserve: 999 }),
		);
		expect(window.localStorage.getItem(legacy)).toBeNull();
	});

	it("reports a failed save and retries the latest settings", async () => {
		server.putErrors.push(new Error("Offline"));
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
		expect((server.puts.at(-1) as { reserve?: number }).reserve).toBe(123);
	});
	it("prefers backend settings over an old browser record", async () => {
		window.localStorage.setItem(
			financialKey(),
			JSON.stringify({ reserve: 999 }),
		);
		server.backend.set(backendKey(), {
			...defaultSafeSpendingSettings(),
			reserve: 123,
		});
		await refreshSafeSpendingSettings();
		expect(useSafeSpendingSettings.getState().reserve).toBe(123);
		expect(server.puts).toHaveLength(0);
	});

	it("does not mount financial preferences when the backend read fails", async () => {
		const transport = new Error("Settings unavailable");
		server.getError = transport;
		const scope = acceptOwner(B);
		const failure = await hydrateFinancialPreferences(scope).catch(
			(cause: unknown) => cause,
		);
		expect(failure).toBeInstanceOf(ApiNetworkError);
		expect((failure as Error).cause).toBe(transport);
		useSafeSpendingSettings.getState().updateSettings({ reserve: 999 });
		expect(useSafeSpendingSettings.getState().reserve).toBe(
			defaultSafeSpendingSettings().reserve,
		);
		expect(server.puts).toHaveLength(0);
	});

	it("serializes rapid edits and stores them only in the backend", async () => {
		useSafeSpendingSettings.getState().updateSettings({ reserve: 123 });
		useSafeSpendingSettings.getState().updateSettings({ reserve: 456 });
		await refreshSafeSpendingSettings();
		expect(
			server.puts.map((body) => (body as { reserve?: number }).reserve),
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
					transactionIds: ["rent"],
				},
				version: 4,
			}),
		);
		await refreshSafeSpendingSettings();
		const state = useSafeSpendingSettings.getState();
		expect(state.reserve).toBe(100);
		expect(state.incomeRuleIds).toEqual(["salary"]);
		expect(state.transactionIds).toEqual(["rent"]);
		for (const key of Object.keys(overrides))
			expect(state).not.toHaveProperty(key);
		state.updateSettings({ reserve: 200 });
		expect(window.localStorage.getItem(financialKey())).toBeNull();
		await refreshSafeSpendingSettings();
		expect(server.puts.at(-1)).not.toHaveProperty("checkingOverride");
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
	it("keeps every financial amount, date, and selected resource ID isolated across users and sample data", async () => {
		const settingsA = {
			statementDay: 8,
			statementDaySet: true,
			reserve: 12345,
			accountIds: ["private-a-card"],
			spendingAccountIds: ["private-a-cash"],
			incomeRuleIds: ["private-a-income", "private-a-partner"],
			transactionIds: ["private-a-bill"],
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
			transactionIds: ["private-b-bill"],
		};
		useSafeSpendingSettings.getState().updateSettings(settingsB);
		await refreshSafeSpendingSettings();
		await verifyOwner(GUEST_USER_ID);
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
		await verifyOwner(GUEST_USER_ID);
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
		suspendUserScope();
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
		for (const id of [A, B, GUEST_USER_ID]) {
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
		const foreign = acceptOwner(A, "https://different-api.example");
		// A foreign API origin cannot reach the network: the scope boundary
		// blocks the request instead of sending workspace credentials there.
		await expect(hydrateFinancialPreferences(foreign)).rejects.toThrow(
			/The API address does not match/,
		);
		expect(useSafeSpendingSettings.getState().reserve).toBe(
			defaultSafeSpendingSettings().reserve,
		);
		await verifyOwner(GUEST_USER_ID);
		useSafeSpendingSettings
			.getState()
			.updateSettings({ reserve: 200, incomeRuleIds: ["sample-income"] });
		await refreshSafeSpendingSettings();
		await verifyOwner(A);
		expect(useSafeSpendingSettings.getState().reserve).toBe(100);
		await verifyOwner(GUEST_USER_ID);
		expect(useSafeSpendingSettings.getState()).toMatchObject({
			reserve: 200,
			incomeRuleIds: ["sample-income"],
		});
		suspendUserScope();
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
			.updateSettings({ reserve: 111, transactionIds: ["private-a-bill"] });
		await refreshSafeSpendingSettings();
		await verifyOwner(B);
		expect(useSafeSpendingSettings.getState()).toMatchObject(
			defaultSafeSpendingSettings(),
		);
		useSafeSpendingSettings.getState().updateSettings({ reserve: 222 });
		await verifyOwner(A);
		expect(useSafeSpendingSettings.getState()).toMatchObject({
			reserve: 111,
			transactionIds: ["private-a-bill"],
		});
	});

	it("rejects writes through a captured storage owner after verification changes", async () => {
		const oldScope = getUserScope();
		const oldStorage = accountLocalStorage(oldScope);
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
