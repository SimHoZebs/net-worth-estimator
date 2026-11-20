import { useQuery } from "@tanstack/react-query";
import { useReducer } from "react";
import { setSafeSpendingSettings } from "@/api/generated/endpoints.ts";
import type { SafeSpendingSettings } from "@/api/contracts.ts";
import {
	getUserScope,
	subscribeUserScope,
	type UserScope,
} from "@/auth/resourceScope.ts";
import { readSafeSpendingSettings } from "@/state/safeSpendingStorage.ts";
import { DEFAULT_PROTECTED_RESERVE } from "@/domain/safeSpending.ts";
import {
	resolveEffectiveIds,
	toggleEffectiveId,
} from "@/domain/safeSpendingSelection.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import { notifyError, dismissKey } from "@/state/notifications.ts";
import { useUserScope } from "@/state/useUserScope.ts";
import { userResourceKey } from "@/state/workspaceResources.ts";

// Query caches server-owned safe-spending settings. Settings stay outside
// the base projection identity, so edits do not rerun the base simulation.
export { resolveEffectiveIds, toggleEffectiveId };

function stringIds(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const ids = value.filter(
		(id): id is string => typeof id === "string" && id !== "",
	);
	return ids.length ? ids : null;
}

function monthlyDay(value: unknown, fallback: number): number {
	return typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= 31
		? value
		: fallback;
}

/** One field list drives defaults, sanitizing and optimistic merges. */
const settingsFields = {
	cycleStartDay: {
		default: 20,
		read: (value: unknown) => monthlyDay(value, 20),
	},
	paydayDay: {
		default: 30,
		read: (value: unknown) => monthlyDay(value, 30),
	},
	savingsTarget: {
		default: 0,
		read: (value: unknown) =>
			typeof value === "number" && Number.isFinite(value)
				? Math.max(0, value)
				: 0,
	},
	reserve: {
		default: DEFAULT_PROTECTED_RESERVE,
		read: (value: unknown) =>
			Math.max(
				0,
				Number.isFinite(Number(value))
					? Number(value)
					: DEFAULT_PROTECTED_RESERVE,
			),
	},
	accountIds: {
		default: null as string[] | null,
		read: stringIds,
	},
	spendingAccountIds: {
		default: null as string[] | null,
		read: stringIds,
	},
	incomeScheduleIds: {
		default: [] as string[],
		read: (value: unknown) => [...new Set(stringIds(value) ?? [])],
	},
	transactionIds: {
		default: null as string[] | null,
		read: stringIds,
	},
};

type SettingKey = keyof SafeSpendingSettings;
const settingKeys = Object.keys(settingsFields) as SettingKey[];

function freshSetting<K extends SettingKey>(key: K): SafeSpendingSettings[K] {
	const value = settingsFields[key].default;
	return (Array.isArray(value) ? [...value] : value) as SafeSpendingSettings[K];
}

export const defaultSafeSpendingSettings = (): SafeSpendingSettings => {
	const result = {} as SafeSpendingSettings;
	for (const key of settingKeys)
		(result as unknown as Record<string, unknown>)[key] = freshSetting(key);
	return result;
};

export function sanitizeSafeSpendingSettings(
	value: unknown,
): SafeSpendingSettings {
	const result = defaultSafeSpendingSettings();
	if (typeof value !== "object" || value === null) return result;
	const record = value as Record<string, unknown>;
	for (const key of settingKeys)
		(result as unknown as Record<string, unknown>)[key] = settingsFields[
			key
		].read(record[key]);
	return result;
}

function mergeSettings(
	previous: SafeSpendingSettings,
	next: Partial<SafeSpendingSettings>,
): SafeSpendingSettings {
	const merged = defaultSafeSpendingSettings();
	for (const key of settingKeys) {
		(merged as unknown as Record<string, unknown>)[key] =
			next[key] !== undefined ? next[key] : previous[key];
	}
	return merged;
}

interface SafeSpendingSettingsState extends SafeSpendingSettings {
	pending: boolean;
	error: boolean;
	updateSettings: (next: Partial<SafeSpendingSettings>) => void;
	retry: () => void;
}

export function safeSpendingSettingsKey(scope = getUserScope()) {
	return ["safe-spending-settings", scope.key] as const;
}

const defaults = defaultSafeSpendingSettings();

function settingsOptions(scope = getUserScope()) {
	return {
		queryKey: safeSpendingSettingsKey(scope),
		staleTime: Infinity,
		queryFn: async ({ signal }: { signal: AbortSignal }) =>
			(await readSafeSpendingSettings(
				scope,
				sanitizeSafeSpendingSettings,
				signal,
			)) ?? defaultSafeSpendingSettings(),
	};
}

export function getSafeSpendingSettings(
	scope = getUserScope(),
): SafeSpendingSettings {
	return scope.status === "pending"
		? defaults
		: (serverQueryClient().getQueryData<SafeSpendingSettings>(
				safeSpendingSettingsKey(scope),
			) ?? defaults);
}

export function updateSettingsForScope(scope: UserScope = getUserScope()) {
	return (next: Partial<SafeSpendingSettings>) => {
		if (
			scope !== getUserScope() ||
			scope.status !== "ready" ||
			serverQueryClient().getQueryState(safeSpendingSettingsKey(scope))
				?.status !== "success"
		)
			return;
		const previous = getSafeSpendingSettings(scope);
		const snapshot = mergeSettings(previous, next);
		const cache = serverQueryClient();
		const key = safeSpendingSettingsKey(scope);
		void cache.cancelQueries({ queryKey: key, exact: true });
		// The cache contains an explicit optimistic value until this mutation succeeds.
		const optimistic = cache.setQueryData(key, snapshot);
		const mutation = cache.getMutationCache().build(cache, {
			mutationKey: key,
			scope: { id: JSON.stringify(key) },
			mutationFn: async () => {
				if (scope !== getUserScope()) return;
				const data = (await setSafeSpendingSettings(snapshot as never)).data;
				if (scope !== getUserScope()) return;
				if (cache.getQueryData(key) === optimistic)
					cache.setQueryData(
						key,
						sanitizeSafeSpendingSettings(
							(data.settings ?? snapshot) as SafeSpendingSettings,
						),
					);
				dismissKey("safe-spending-settings");
				void cache.invalidateQueries({
					queryKey: userResourceKey("safe-spending-summary", scope),
				});
			},
			onError: async (error) => {
				if (scope !== getUserScope()) return;
				notifyError(
					"safe-spending-settings",
					`Budget settings were not saved. ${error instanceof Error ? error.message : "Unknown error"}`,
					{
						label: "Retry save",
						onAction: () => updateSettingsForScope(scope)(snapshot),
						pendingLabel: "Retrying…",
					},
				);
				// Don't pair a server summary with a goal the server did not save.
				// A preceding queued write may have succeeded, so re-read the saved
				// values rather than restoring another optimistic snapshot.
				if (cache.getQueryData(key) === optimistic) {
					await cache.invalidateQueries({
						queryKey: key,
						exact: true,
						refetchType: "none",
					});
					if (
						scope === getUserScope() &&
						cache.getQueryData(key) === optimistic
					)
						await cache.fetchQuery(settingsOptions(scope)).catch(() => {});
				}
			},
		});
		const pending = mutation.execute(undefined);
		void pending.catch(() => {});
		return pending;
	};
}

export async function refreshSafeSpendingSettings() {
	const scope = getUserScope();
	if (scope.status === "pending") return;
	const cache = serverQueryClient();
	const key = safeSpendingSettingsKey(scope);
	if (cache.isMutating({ mutationKey: key })) {
		await new Promise<void>((resolve) => {
			const stop = cache.getMutationCache().subscribe(() => {
				if (!cache.isMutating({ mutationKey: key })) {
					stop();
					resolve();
				}
			});
		});
	}
	if (scope !== getUserScope()) return;
	await cache.invalidateQueries({ queryKey: key, refetchType: "none" });
	await cache.fetchQuery(settingsOptions(scope));
}

/** Query owns both the saved response and its explicit optimistic updates. */
export function useSafeSpendingSettings(): SafeSpendingSettingsState {
	const scope = useUserScope();
	const query = useQuery(
		{ ...settingsOptions(scope), enabled: scope.status === "ready" },
		serverQueryClient(),
	);
	// The optimistic write reads cache directly so it shows in the same event.
	const [, bump] = useReducer((version: number) => version + 1, 0);
	const settings = getSafeSpendingSettings(scope);
	return {
		...settings,
		pending: query.isPending,
		error: query.isError,
		retry: () => {
			void query.refetch();
		},
		updateSettings: (next) => {
			updateSettingsForScope(scope)(next);
			bump();
		},
	};
}

function bindFinancialPreferences(): void {
	const scope = getUserScope();
	const cache = serverQueryClient();
	void cache.cancelQueries({ queryKey: ["safe-spending-settings"] });
	cache.removeQueries({ queryKey: ["safe-spending-settings"] });
	if (scope.status === "ready")
		void cache.fetchQuery(settingsOptions(scope)).catch(() => {});
}

/**
 * Await this owner's stored preferences. The session boundary no longer
 * gates the workspace on them; screens that read financial settings show
 * their own pending slot until the query resolves.
 */
export async function hydrateFinancialPreferences(
	scope: UserScope,
): Promise<boolean> {
	if (scope !== getUserScope() || scope.status !== "ready") return false;
	try {
		await serverQueryClient().fetchQuery(settingsOptions(scope));
	} catch (error) {
		if (scope === getUserScope()) throw error;
		else return false;
	}
	return (
		scope === getUserScope() &&
		scope.status === "ready" &&
		serverQueryClient().getQueryState(safeSpendingSettingsKey(scope))
			?.status === "success"
	);
}

subscribeUserScope(bindFinancialPreferences);
bindFinancialPreferences();

/** Test hook: restores safe spending defaults between cases. */
export function resetSafeSpendingSettings(): void {
	serverQueryClient().removeQueries({ queryKey: ["safe-spending-settings"] });
}
