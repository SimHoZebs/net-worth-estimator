import { useIsMutating, useQuery } from "@tanstack/react-query";
import { useReducer } from "react";
import { setSafeSpendingSettings } from "@/api/generated/endpoints.ts";
import {
	type SafeSpendingSettings,
	toGeneratedSafeSpendingBody,
} from "@/api/contracts.ts";
import {
	getUserScope,
	subscribeUserScope,
	type UserScope,
} from "@/auth/resourceScope.ts";
import { isRecord } from "@/domain/guards.ts";
import { readSafeSpendingSettings } from "@/state/safeSpendingStorage.ts";
import {
	resolveEffectiveIds,
	toggleEffectiveId,
} from "@/domain/safeSpendingSelection.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import { notifyError, dismissKey } from "@/state/notifications.ts";
import { fetchScopedQuery, runScopedMutation } from "@/state/scopedState.ts";
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

type SettingKey = keyof SafeSpendingSettings;

type SettingsField<K extends SettingKey> = {
	default: SafeSpendingSettings[K];
	read: (value: unknown) => SafeSpendingSettings[K];
};

/** One field list drives defaults, sanitizing and optimistic merges. */
const settingsFields: { [K in SettingKey]: SettingsField<K> } = {
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
	accountIds: {
		default: null as string[] | null,
		read: (value: unknown) =>
			Array.isArray(value) ? (stringIds(value) ?? []) : null,
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

const settingKeys = Object.keys(settingsFields) as SettingKey[];

function freshSetting<K extends SettingKey>(key: K): SafeSpendingSettings[K] {
	return structuredClone(settingsFields[key].default);
}

/** Generic keyed assignment keeps each field's value tied to its own key. */
function assignSetting<K extends SettingKey>(
	target: SafeSpendingSettings,
	key: K,
	value: SafeSpendingSettings[K],
): void {
	target[key] = value;
}

export const defaultSafeSpendingSettings = (): SafeSpendingSettings => ({
	cycleStartDay: freshSetting("cycleStartDay"),
	paydayDay: freshSetting("paydayDay"),
	savingsTarget: freshSetting("savingsTarget"),
	accountIds: freshSetting("accountIds"),
	spendingAccountIds: freshSetting("spendingAccountIds"),
	incomeScheduleIds: freshSetting("incomeScheduleIds"),
	transactionIds: freshSetting("transactionIds"),
});

export function sanitizeSafeSpendingSettings(
	value: unknown,
): SafeSpendingSettings {
	const result = defaultSafeSpendingSettings();
	if (!isRecord(value)) return result;
	for (const key of settingKeys)
		assignSetting(result, key, settingsFields[key].read(value[key]));
	return result;
}

function mergeSettings(
	previous: SafeSpendingSettings,
	next: Partial<SafeSpendingSettings>,
): SafeSpendingSettings {
	const merged = defaultSafeSpendingSettings();
	for (const key of settingKeys) {
		const value = next[key];
		assignSetting(merged, key, value === undefined ? previous[key] : value);
	}
	return merged;
}

interface SafeSpendingSettingsState extends SafeSpendingSettings {
	pending: boolean;
	error: boolean;
	mutating: boolean;
	revision: number;
	updateSettings: SafeSpendingSettingsUpdate;
	retry: () => void;
}

export type SafeSpendingSettingsUpdateOptions = {
	retry?: boolean;
};

export type SafeSpendingSettingsUpdate = (
	next: Partial<SafeSpendingSettings>,
	options?: SafeSpendingSettingsUpdateOptions,
) => Promise<void | null> | undefined;

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
	return (
		next: Partial<SafeSpendingSettings>,
		options: SafeSpendingSettingsUpdateOptions = {},
	) => {
		const retry = options.retry ?? true;
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
		const pending = runScopedMutation<void>({
			key,
			mutationFn: async () => {
				const data = (
					await setSafeSpendingSettings(toGeneratedSafeSpendingBody(snapshot))
				).data;
				if (scope !== getUserScope()) return;
				if (cache.getQueryData(key) === optimistic)
					cache.setQueryData(
						key,
						isRecord(data.settings)
							? sanitizeSafeSpendingSettings(data.settings)
							: snapshot,
					);
				dismissKey("safe-spending-settings");
				void cache.invalidateQueries({
					queryKey: userResourceKey("safe-spending-summary", scope),
				});
			},
			rethrow: true,
			onError: async (error) => {
				if (scope !== getUserScope()) return;
				notifyError(
					"safe-spending-settings",
					`Budget settings were not saved. ${error instanceof Error ? error.message : "Unknown error"}`,
					retry
						? {
								label: "Retry save",
								onAction: () => updateSettingsForScope(scope)(snapshot),
								pendingLabel: "Retrying…",
							}
						: undefined,
				);
				// Don't pair a server summary with a goal the server did not save.
				// A preceding queued write may have succeeded, so re-read the saved
				// values without putting the query into an error state. If that read
				// also fails, restore the pre-write snapshot. Both writes are guarded
				// so a newer optimistic value is never clobbered.
				if (cache.getQueryData(key) === optimistic) {
					const recovered = await readSafeSpendingSettings(
						scope,
						sanitizeSafeSpendingSettings,
					).catch(() => previous);
					if (
						scope === getUserScope() &&
						cache.getQueryData(key) === optimistic
					)
						cache.setQueryData(key, recovered ?? defaultSafeSpendingSettings());
				}
			},
		});
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
	await fetchScopedQuery(settingsOptions(scope), true);
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
	const mutating =
		useIsMutating(
			{ mutationKey: safeSpendingSettingsKey(scope) },
			serverQueryClient(),
		) > 0;
	return {
		...settings,
		pending: query.isPending,
		error: query.isError,
		mutating,
		revision: query.dataUpdatedAt,
		retry: () => {
			void query.refetch();
		},
		updateSettings: (next, options) => {
			const pending = updateSettingsForScope(scope)(next, options);
			bump();
			return pending;
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
