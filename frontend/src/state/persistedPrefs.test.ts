import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiNetworkError } from "../api/http.ts";
import { toast } from "../components/ui/toast.tsx";
import type { SafeSpendingSettings } from "../api/contracts.ts";
import {
	acceptUserScope,
	canonicalApiBaseUrl,
	getUserScope,
	suspendUserScope,
} from "../auth/resourceScope.ts";
import {
	THEME_STORAGE_KEY,
	UI_PREFS_STORAGE_KEY,
	clearPersistedMemory,
} from "./persisted.ts";
import { resetUiStore, useUiStore } from "./uiStore.ts";
import {
	getThemePreference,
	rehydrateThemeFromStorage,
	setThemePreference,
} from "./useTheme.ts";
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

let published: {
	id?: string;
	type?: unknown;
	description?: unknown;
	actionProps?: { children?: unknown; onClick?: unknown };
	onClose?: unknown;
}[] = [];
let closed: (string | undefined)[] = [];

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
	vi.spyOn(toast, "add").mockImplementation((options) => {
		published.push(options);
		return options.id ?? "toast-test";
	});
	vi.spyOn(toast, "close").mockImplementation((id) => {
		closed.push(id);
	});
	vi.unstubAllGlobals();
	suspendUserScope();
	stubStorage(memoryStorage());
	clearPersistedMemory();
	useUiStore.persist.setOptions({
		name: UI_PREFS_STORAGE_KEY,
	});
	resetUiStore();
	setThemePreference("system");
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
	published = [];
	closed = [];
});

afterEach(() => {
	suspendUserScope();
	clearPersistedMemory();
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("unified persisted prefs", () => {
	it("reports a failed save and retries the latest settings", async () => {
		server.putErrors.push(new Error("Offline"));
		useSafeSpendingSettings.getState().updateSettings({ reserve: 123 });
		await vi.waitFor(() =>
			expect(published).toContainEqual(
				expect.objectContaining({
					id: "safe-spending-settings",
					type: "error",
					description: expect.stringContaining("not saved"),
				}),
			),
		);
		const options = published.find(
			(entry) => entry.id === "safe-spending-settings",
		);
		(options?.actionProps?.onClick as (() => void) | undefined)?.();
		await vi.waitFor(() => expect(closed).toContain("safe-spending-settings"));
		expect((server.puts.at(-1) as { reserve?: number }).reserve).toBe(123);
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

	it("reads the stored plain-string preference and keeps corrupt data safe", async () => {
		window.localStorage.setItem(THEME_STORAGE_KEY, "dark");
		rehydrateThemeFromStorage();
		expect(getThemePreference()).toBe("dark");

		window.localStorage.setItem(THEME_STORAGE_KEY, "light");
		rehydrateThemeFromStorage();
		expect(getThemePreference()).toBe("light");

		setThemePreference("system");
		window.localStorage.setItem(THEME_STORAGE_KEY, "{bad");
		rehydrateThemeFromStorage();
		expect(getThemePreference()).toBe("system");
	});

	it("persists explicit income sources and an empty selection across reloads", async () => {
		useSafeSpendingSettings
			.getState()
			.updateSettings({ incomeScheduleIds: ["salary", "partner"] });
		await refreshSafeSpendingSettings();
		expect(useSafeSpendingSettings.getState().incomeScheduleIds).toEqual([
			"salary",
			"partner",
		]);
		useSafeSpendingSettings
			.getState()
			.updateSettings({ incomeScheduleIds: [] });
		await refreshSafeSpendingSettings();
		expect(useSafeSpendingSettings.getState().incomeScheduleIds).toEqual([]);
	});

	it("sanitizes income rule IDs without an automatic fallback", () => {
		expect(
			sanitizeSafeSpendingSettings({
				incomeScheduleIds: ["salary", 123, "", "salary", "partner"],
			}).incomeScheduleIds,
		).toEqual(["salary", "partner"]);
		for (const incomeScheduleIds of [null, undefined, [], "salary", [123]]) {
			expect(
				sanitizeSafeSpendingSettings({ incomeScheduleIds }).incomeScheduleIds,
			).toEqual([]);
		}
	});

	it("sanitizes safe spending settings with clamping and drops unknown fields", () => {
		expect(
			sanitizeSafeSpendingSettings({ statementDay: 1, reserve: -5 })
				.statementDay,
		).toBe(1);
		expect(
			sanitizeSafeSpendingSettings({ statementDay: 1, reserve: -5 }).reserve,
		).toBe(0);
		expect(
			sanitizeSafeSpendingSettings({ statementDay: 99, reserve: 50 })
				.statementDay,
		).toBe(28);
		expect(sanitizeSafeSpendingSettings(null).reserve).toBeGreaterThanOrEqual(
			0,
		);
		const state = sanitizeSafeSpendingSettings({
			statementDay: 5,
			reserve: 100,
			mandatoryFrame: "cycle",
		});
		expect(state.statementDay).toBe(5);
		expect(state.reserve).toBe(100);
		expect(state).not.toHaveProperty("mandatoryFrame");
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
			incomeScheduleIds: ["private-a-income", "private-a-partner"],
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
			incomeScheduleIds: [],
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
			.updateSettings({ reserve: 42, incomeScheduleIds: ["sample-income"] });
		await refreshSafeSpendingSettings();
		await verifyOwner(A);
		expect(useSafeSpendingSettings.getState()).toMatchObject(settingsA);
		await verifyOwner(B);
		expect(useSafeSpendingSettings.getState()).toMatchObject(settingsB);
		await verifyOwner(GUEST_USER_ID);
		expect(useSafeSpendingSettings.getState()).toMatchObject({
			reserve: 42,
			incomeScheduleIds: ["sample-income"],
		});
	});

	it("resets synchronously during verification and rejects stale actions without overwriting saved preferences", async () => {
		const oldAction = useSafeSpendingSettings.getState().updateSettings;
		oldAction({ reserve: 123, incomeScheduleIds: ["private-a-income"] });
		await refreshSafeSpendingSettings();
		suspendUserScope();
		expect(useSafeSpendingSettings.getState()).toMatchObject(
			defaultSafeSpendingSettings(),
		);
		oldAction({ reserve: 999, accountIds: ["stale-a-card"] });
		useSafeSpendingSettings.getState().updateSettings({ reserve: 555 });
		expect(useSafeSpendingSettings.getState()).toMatchObject(
			defaultSafeSpendingSettings(),
		);
		await verifyOwner(B);
		oldAction({ reserve: 999, incomeScheduleIds: ["stale-a-income"] });
		expect(useSafeSpendingSettings.getState()).toMatchObject(
			defaultSafeSpendingSettings(),
		);
		await verifyOwner(A);
		expect(useSafeSpendingSettings.getState()).toMatchObject({
			reserve: 123,
			incomeScheduleIds: ["private-a-income"],
		});
	});

	it("isolates the sample and API origins without changing global display preferences", async () => {
		setThemePreference("dark");
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
			.updateSettings({ reserve: 200, incomeScheduleIds: ["sample-income"] });
		await refreshSafeSpendingSettings();
		await verifyOwner(A);
		expect(useSafeSpendingSettings.getState().reserve).toBe(100);
		await verifyOwner(GUEST_USER_ID);
		expect(useSafeSpendingSettings.getState()).toMatchObject({
			reserve: 200,
			incomeScheduleIds: ["sample-income"],
		});
		suspendUserScope();
		expect(getThemePreference()).toBe("dark");
		expect(useUiStore.getState()).toMatchObject({ years: 30, ranges: false });
		expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
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
});
