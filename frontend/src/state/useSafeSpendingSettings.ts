import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import {
	getResourceScope,
	subscribeResourceScope,
	type ResourceScope,
} from "../auth/resourceScope.ts";
import {
	DEFAULT_CYCLE_STATEMENT_DAY,
	DEFAULT_PROTECTED_RESERVE,
} from "../domain/safeSpending.ts";
import {
	resourceLocalStorage,
	SAFE_SPENDING_STORAGE_KEY,
} from "./persisted.ts";

export interface TotalCycleSettings {
	statementDay: number;
	reserve: number;
	/** Null means every debt account counts toward the total. */
	accountIds: string[] | null;
	/** Null means the detected checking account alone counts as spendable. */
	spendingAccountIds: string[] | null;
	/** Explicit recurrence rule sources. Empty means no automatic income. */
	incomeRuleIds: string[];
	/** Null means every recurring outflow counts as a bill. */
	movementIds: string[] | null;
	/** True once the statement day is explicitly chosen. Untouched legacy 1st falls back to the household 20th. */
	statementDaySet: boolean;
}

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

function looksLikeSettings(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		"statementDay" in record ||
		"reserve" in record ||
		"accountIds" in record ||
		"incomeRuleIds" in record ||
		"movementIds" in record ||
		"mandatoryFrame" in record
	);
}

/**
 * Reads envelopes and raw settings only within the verified resource namespace.
 * Unscoped financial settings and legacy keys have no established owner.
 */
function safeSpendingStorage(
	scope: ResourceScope,
	canWrite: () => boolean,
): PersistStorage<TotalCycleSettings> {
	const storage = resourceLocalStorage(scope);
	const readRawSettings = (raw: string | null): TotalCycleSettings | null => {
		if (raw === null) return null;
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (typeof parsed === "object" && parsed !== null) {
				const record = parsed as Record<string, unknown>;
				if (
					typeof record.state === "object" &&
					record.state !== null &&
					looksLikeSettings(record.state)
				) {
					return sanitizeSafeSpendingSettings(record.state);
				}
				if (looksLikeSettings(parsed))
					return sanitizeSafeSpendingSettings(parsed);
			}
		} catch {
			return null;
		}
		return null;
	};
	return {
		getItem: (name) => {
			const parse = (raw: string | null) => {
				const state = readRawSettings(raw);
				return state ? { state, version: 4 } : null;
			};
			const raw = storage.getItem(name);
			return raw instanceof Promise ? raw.then(parse) : parse(raw);
		},
		setItem: (name, value) => {
			if (canWrite()) return storage.setItem(name, JSON.stringify(value));
		},
		removeItem: (name) => storage.removeItem(name),
	};
}

interface SafeSpendingSettingsState extends TotalCycleSettings {
	updateSettings: (next: Partial<TotalCycleSettings>) => void;
}

let writableScope: ResourceScope | null = null;
let boundScope = getResourceScope();
let hydration: Promise<void> = Promise.resolve();

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
			storage: safeSpendingStorage(boundScope, () => false),
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
	useSafeSpendingSettings.persist.setOptions({
		storage: safeSpendingStorage(scope, () => writableScope === scope),
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
	return scope === getResourceScope() && writableScope === scope;
}

subscribeResourceScope(bindFinancialPreferences);
bindFinancialPreferences();

/** Test hook: restores safe spending defaults between cases. */
export function resetSafeSpendingSettings(): void {
	useSafeSpendingSettings.setState({ ...defaultSafeSpendingSettings() });
}
