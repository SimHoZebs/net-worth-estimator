import { create } from "zustand";
import type { SafeSpendingSettings } from "../api/contracts.ts";
import { persist } from "zustand/middleware";
import {
	getResourceScope,
	subscribeResourceScope,
	type ResourceScope,
} from "../auth/resourceScope.ts";
import {
	DEFAULT_CYCLE_STATEMENT_DAY,
	DEFAULT_PROTECTED_RESERVE,
} from "../domain/safeSpending.ts";
import { SAFE_SPENDING_STORAGE_KEY } from "./persisted.ts";
import { safeSpendingStorage } from "./safeSpendingStorage.ts";

export type TotalCycleSettings = SafeSpendingSettings;

export const defaultSafeSpendingSettings = (): TotalCycleSettings => ({
	statementDay: DEFAULT_CYCLE_STATEMENT_DAY,
	reserve: DEFAULT_PROTECTED_RESERVE,
	accountIds: null,
	spendingAccountIds: null,
	incomeRuleIds: [],
	movementIds: null,
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
	const parsed = (value as Record<string, unknown>).state ?? value;
	if (typeof parsed !== "object" || parsed === null) return fallback;
	const record = parsed as Record<string, unknown>;
	const statementDaySet = record.statementDaySet === true;
	const storedDay = clampStatementDay(record.statementDay);
	return {
		statementDay:
			!statementDaySet && storedDay === 1
				? DEFAULT_CYCLE_STATEMENT_DAY
				: storedDay,
		statementDaySet,
		reserve: Math.max(
			0,
			Number.isFinite(Number(record.reserve))
				? Number(record.reserve)
				: DEFAULT_PROTECTED_RESERVE,
		),
		accountIds: stringIds(record.accountIds),
		spendingAccountIds: stringIds(record.spendingAccountIds),
		incomeRuleIds: [...new Set(stringIds(record.incomeRuleIds) ?? [])],
		movementIds: stringIds(record.movementIds),
	};
}

interface SafeSpendingSettingsState extends TotalCycleSettings {
	updateSettings: (next: Partial<TotalCycleSettings>) => void;
}

let writableScope: ResourceScope | null = null;
let boundScope = getResourceScope();
let hydration: Promise<void> = Promise.resolve();
let loadError: Error | null = null;

function backendStorage(scope: ResourceScope, canWrite: () => boolean) {
	return safeSpendingStorage(
		scope,
		canWrite,
		sanitizeSafeSpendingSettings,
		(error) => {
			loadError = error;
		},
		() => {
			if (scope === getResourceScope())
				useSafeSpendingSettings.getState().updateSettings({});
		},
	);
}

function updateSettingsForScope(scope: ResourceScope) {
	return (next: Partial<TotalCycleSettings>) => {
		if (scope !== getResourceScope() || writableScope !== scope) return;
		useSafeSpendingSettings.setState((previous) => ({
			statementDay: next.statementDay ?? previous.statementDay,
			statementDaySet: next.statementDaySet ?? previous.statementDaySet,
			reserve: next.reserve ?? previous.reserve,
			accountIds:
				next.accountIds !== undefined ? next.accountIds : previous.accountIds,
			spendingAccountIds:
				next.spendingAccountIds !== undefined
					? next.spendingAccountIds
					: previous.spendingAccountIds,
			incomeRuleIds: next.incomeRuleIds ?? previous.incomeRuleIds,
			movementIds:
				next.movementIds !== undefined
					? next.movementIds
					: previous.movementIds,
		}));
	};
}

export const useSafeSpendingSettings = create<SafeSpendingSettingsState>()(
	persist(
		() => ({
			...defaultSafeSpendingSettings(),
			updateSettings: updateSettingsForScope(boundScope),
		}),
		{
			name: SAFE_SPENDING_STORAGE_KEY,
			version: 4,
			storage: backendStorage(boundScope, () => false),
			skipHydration: true,
			partialize: (state) => ({
				statementDay: state.statementDay,
				reserve: state.reserve,
				accountIds: state.accountIds,
				spendingAccountIds: state.spendingAccountIds,
				incomeRuleIds: state.incomeRuleIds,
				movementIds: state.movementIds,
				statementDaySet: state.statementDaySet,
			}),
			migrate: (persisted) => sanitizeSafeSpendingSettings(persisted),
			merge: (persisted, current) => ({
				...current,
				...sanitizeSafeSpendingSettings(persisted),
			}),
		},
	),
);

function bindFinancialPreferences(): void {
	const scope = getResourceScope();
	boundScope = scope;
	writableScope = null;
	loadError = null;
	useSafeSpendingSettings.persist.setOptions({
		storage: backendStorage(scope, () => writableScope === scope),
	});
	// Reset without writing defaults over this owner's saved preferences.
	useSafeSpendingSettings.setState({
		...defaultSafeSpendingSettings(),
		updateSettings: updateSettingsForScope(scope),
	});
	// Rehydrate even while pending to invalidate an older asynchronous hydration.
	const result = useSafeSpendingSettings.persist.rehydrate();
	const finish = () => {
		if (
			scope === getResourceScope() &&
			scope.status !== "pending" &&
			!loadError &&
			useSafeSpendingSettings.persist.hasHydrated()
		)
			writableScope = scope;
	};
	if (result instanceof Promise) hydration = result.then(finish);
	else {
		finish();
		hydration = Promise.resolve();
	}
}

/** The session boundary waits for this owner before it mounts financial screens. */
export async function hydrateFinancialPreferences(
	scope: ResourceScope,
): Promise<boolean> {
	if (boundScope !== scope) return false;
	await hydration;
	if (scope === getResourceScope() && loadError) throw loadError;
	return scope === getResourceScope() && writableScope === scope;
}

subscribeResourceScope(bindFinancialPreferences);
bindFinancialPreferences();

/** Test hook: restores safe spending defaults between cases. */
export function resetSafeSpendingSettings(): void {
	useSafeSpendingSettings.setState({ ...defaultSafeSpendingSettings() });
}
