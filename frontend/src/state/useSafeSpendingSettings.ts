import { useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
import { setSafeSpendingSettings } from "@/api/generated/endpoints.ts";
import type { SafeSpendingSettings } from "@/api/contracts.ts";
import {
	getUserScope,
	subscribeUserScope,
	type UserScope,
} from "@/auth/resourceScope.ts";
import {
	DEFAULT_CYCLE_STATEMENT_DAY,
	DEFAULT_PROTECTED_RESERVE,
} from "@/domain/safeSpending.ts";
import { readSafeSpendingSettings } from "@/state/safeSpendingStorage.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import { notifyError, dismissKey } from "@/state/notifications.ts";

// Query caches server-owned safe-spending settings. Settings stay outside
// the base projection identity, so edits do not rerun the base simulation.
export type TotalCycleSettings = SafeSpendingSettings;

export const defaultSafeSpendingSettings = (): TotalCycleSettings => ({
	statementDay: DEFAULT_CYCLE_STATEMENT_DAY,
	reserve: DEFAULT_PROTECTED_RESERVE,
	accountIds: null,
	spendingAccountIds: null,
	incomeAccountIds: null,
	incomeRuleIds: [],
	transactionIds: null,
	statementDaySet: false,
});

function stringIds(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const ids = value.filter(
		(id): id is string => typeof id === "string" && id !== "",
	);
	return ids.length ? ids : null;
}

export function clampStatementDay(value: unknown): number {
	return Math.min(
		28,
		Math.max(1, Math.floor(Number(value) || DEFAULT_CYCLE_STATEMENT_DAY)),
	);
}

/** Single null-means-all resolver: stored `null` means every known id;
 * unknown ids drop out; an empty selection falls back to the full set so a
 * deleted account never silently empties the effective set. Pass `fallback`
 * to override the empty-selection result (e.g. the detected checking
 * account instead of every account). */
export function resolveEffectiveIds(
	stored: string[] | null,
	knownIds: string[],
	fallback?: string[],
): string[] {
	const known = new Set(knownIds);
	const fallbackIds = (fallback ?? knownIds).filter((id) => known.has(id));
	if (!stored) return fallbackIds;
	const selected = stored.filter((id) => known.has(id));
	return selected.length ? selected : fallbackIds;
}
export function sanitizeSafeSpendingSettings(
	value: unknown,
): TotalCycleSettings {
	const fallback = defaultSafeSpendingSettings();
	if (typeof value !== "object" || value === null) return fallback;
	const record = value as Record<string, unknown>;
	return {
		statementDay: clampStatementDay(record.statementDay),
		statementDaySet: record.statementDaySet === true,
		reserve: Math.max(
			0,
			Number.isFinite(Number(record.reserve))
				? Number(record.reserve)
				: DEFAULT_PROTECTED_RESERVE,
		),
		accountIds: stringIds(record.accountIds),
		spendingAccountIds: stringIds(record.spendingAccountIds),
		incomeAccountIds: stringIds(record.incomeAccountIds),
		incomeRuleIds: [...new Set(stringIds(record.incomeRuleIds) ?? [])],
		transactionIds: stringIds(record.transactionIds),
	};
}

interface SafeSpendingSettingsState extends TotalCycleSettings {
	updateSettings: (next: Partial<TotalCycleSettings>) => void;
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
): TotalCycleSettings {
	return scope.status === "pending"
		? defaults
		: (serverQueryClient().getQueryData<TotalCycleSettings>(
				safeSpendingSettingsKey(scope),
			) ?? defaults);
}

function subscribeSettings(listener: () => void) {
	return serverQueryClient().getQueryCache().subscribe(listener);
}

export function updateSettingsForScope(scope: UserScope = getUserScope()) {
	return (next: Partial<TotalCycleSettings>) => {
		if (
			scope !== getUserScope() ||
			scope.status !== "ready" ||
			serverQueryClient().getQueryState(safeSpendingSettingsKey(scope))
				?.status !== "success"
		)
			return;
		const previous = getSafeSpendingSettings(scope);
		const snapshot: TotalCycleSettings = {
			statementDay: next.statementDay ?? previous.statementDay,
			statementDaySet: next.statementDaySet ?? previous.statementDaySet,
			reserve: next.reserve ?? previous.reserve,
			accountIds:
				next.accountIds !== undefined ? next.accountIds : previous.accountIds,
			spendingAccountIds:
				next.spendingAccountIds !== undefined
					? next.spendingAccountIds
					: previous.spendingAccountIds,
			incomeAccountIds:
				next.incomeAccountIds !== undefined
					? next.incomeAccountIds
					: previous.incomeAccountIds,
			incomeRuleIds: next.incomeRuleIds ?? previous.incomeRuleIds,
			transactionIds:
				next.transactionIds !== undefined
					? next.transactionIds
					: previous.transactionIds,
		};
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
			},
			onError: (error) => {
				if (scope !== getUserScope()) return;
				notifyError(
					"safe-spending-settings",
					`Budget settings were not saved. ${error instanceof Error ? error.message : "Unknown error"}`,
					{
						label: "Retry save",
						onAction: () => updateSettingsForScope(scope)({}),
					},
				);
			},
		});
		void mutation.execute(undefined).catch(() => {});
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
	const scope = useSyncExternalStore(subscribeUserScope, getUserScope);
	useQuery(
		{ ...settingsOptions(scope), enabled: scope.status === "ready" },
		serverQueryClient(),
	);
	// Controlled inputs need the cache write in the same event, before Query's batched observer notification.
	const settings = useSyncExternalStore(subscribeSettings, () =>
		getSafeSpendingSettings(scope),
	);
	return {
		...settings,
		updateSettings: updateSettingsForScope(scope),
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

/** The session boundary waits for this owner before it mounts financial screens. */
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
