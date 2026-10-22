import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import {
	DEFAULT_CYCLE_STATEMENT_DAY,
	DEFAULT_PROTECTED_RESERVE,
} from "../domain/safeSpending.ts";
import {
	appJsonStorage,
	appLocalStorage,
	SAFE_SPENDING_LEGACY_KEYS,
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

export function sanitizeSafeSpendingSettings(
	value: unknown,
): TotalCycleSettings {
	const fallback = defaultSafeSpendingSettings();
	if (typeof value !== "object" || value === null) return fallback;
	const parsed = (value as Record<string, unknown>).state ?? value;
	if (typeof parsed !== "object" || parsed === null) return fallback;
	const record = parsed as Record<string, unknown>;
	const statementDaySet = record.statementDaySet === true;
	const storedDay = Math.min(
		28,
		Math.max(
			1,
			Math.floor(Number(record.statementDay) || DEFAULT_CYCLE_STATEMENT_DAY),
		),
	);
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
 * Reads the persist envelope plus the pre-migration raw settings object
 * (`{"statementDay":20,...}`) and legacy keys v3/v2. Writes always target
 * the primary key in envelope form.
 */
function safeSpendingStorage(): PersistStorage<TotalCycleSettings> | undefined {
	const fallback = appJsonStorage<TotalCycleSettings>();
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
			const primary = readRawSettings(
				(() => {
					try {
						return appLocalStorage.getItem(name) as string | null;
					} catch {
						return null;
					}
				})(),
			);
			if (primary !== null) return { state: primary, version: 4 };
			for (const key of SAFE_SPENDING_LEGACY_KEYS) {
				try {
					const legacy = readRawSettings(
						appLocalStorage.getItem(key) as string | null,
					);
					if (legacy !== null) return { state: legacy, version: 0 };
				} catch {
					continue;
				}
			}
			return null;
		},
		setItem: (name, value) => {
			if (fallback) fallback.setItem(name, value);
			else {
				try {
					appLocalStorage.setItem(name, JSON.stringify(value));
				} catch {
					// Storage is best-effort; the tracker still works this session.
				}
			}
		},
		removeItem: (name) => {
			if (fallback) fallback.removeItem(name);
			else {
				try {
					appLocalStorage.removeItem(name);
				} catch {
					// Ignore.
				}
			}
		},
	};
}

interface SafeSpendingSettingsState extends TotalCycleSettings {
	updateSettings: (next: Partial<TotalCycleSettings>) => void;
}

export const useSafeSpendingSettings = create<SafeSpendingSettingsState>()(
	persist(
		(set) => ({
			...defaultSafeSpendingSettings(),
			updateSettings: (next) =>
				set((previous) => ({
					statementDay: next.statementDay ?? previous.statementDay,
					statementDaySet: next.statementDaySet ?? previous.statementDaySet,
					reserve: next.reserve ?? previous.reserve,
					accountIds:
						next.accountIds !== undefined
							? next.accountIds
							: previous.accountIds,
					spendingAccountIds:
						next.spendingAccountIds !== undefined
							? next.spendingAccountIds
							: previous.spendingAccountIds,
					incomeRuleIds: next.incomeRuleIds ?? previous.incomeRuleIds,
					movementIds:
						next.movementIds !== undefined
							? next.movementIds
							: previous.movementIds,
				})),
		}),
		{
			name: SAFE_SPENDING_STORAGE_KEY,
			version: 4,
			storage: safeSpendingStorage(),
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

/** Test hook: restores safe spending defaults between cases. */
export function resetSafeSpendingSettings(): void {
	useSafeSpendingSettings.setState({ ...defaultSafeSpendingSettings() });
}
