import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";
import { parseDisplayNumber } from "../components/editors/formValues.ts";
import {
	DEFAULT_CYCLE_STATEMENT_DAY,
	DEFAULT_PROTECTED_RESERVE,
} from "../domain/householdTiming.ts";
import {
	appJsonStorage,
	appLocalStorage,
	TIMING_LEGACY_KEYS,
	TIMING_STORAGE_KEY,
} from "./persisted.ts";

export interface TotalCycleSettings {
	statementDay: number;
	reserve: number;
	spentOverride: number | null;
	paycheckOverride: number | null;
	fixedOverride: number | null;
	checkingOverride: number | null;
	remainingOverride: number | null;
	/** Null means every debt account counts toward the total. */
	accountIds: string[] | null;
	/** Null means the detected checking account alone counts as spendable. */
	spendingAccountIds: string[] | null;
	/** Null means every recurring outflow counts as a bill. */
	movementIds: string[] | null;
	/** Which window the drawer bills tab uses. Card figures stay calendar. */
	mandatoryFrame: "calendar" | "cycle";
	/** True once the statement day is explicitly chosen. Untouched legacy 1st falls back to the household 20th. */
	statementDaySet: boolean;
}

export const defaultTimingSettings = (): TotalCycleSettings => ({
	statementDay: DEFAULT_CYCLE_STATEMENT_DAY,
	reserve: DEFAULT_PROTECTED_RESERVE,
	spentOverride: null,
	paycheckOverride: null,
	fixedOverride: null,
	checkingOverride: null,
	remainingOverride: null,
	accountIds: null,
	spendingAccountIds: null,
	movementIds: null,
	mandatoryFrame: "calendar",
	statementDaySet: false,
});

function optionalMoney(value: unknown): number | null {
	if (value === null || value === undefined || value === "") return null;
	const parsed = parseDisplayNumber(String(value));
	if (parsed === null || parsed < 0) return null;
	return parsed;
}

function stringIds(value: unknown): string[] | null {
	if (!Array.isArray(value)) return null;
	const ids = value.filter(
		(id): id is string => typeof id === "string" && id !== "",
	);
	return ids.length ? ids : null;
}

export function sanitizeTimingSettings(value: unknown): TotalCycleSettings {
	const fallback = defaultTimingSettings();
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
		spentOverride: optionalMoney(record.spentOverride),
		paycheckOverride: optionalMoney(record.paycheckOverride),
		fixedOverride: optionalMoney(record.fixedOverride),
		checkingOverride: optionalMoney(record.checkingOverride),
		remainingOverride: optionalMoney(record.remainingOverride),
		accountIds: stringIds(record.accountIds),
		spendingAccountIds: stringIds(record.spendingAccountIds),
		movementIds: stringIds(record.movementIds),
		mandatoryFrame: record.mandatoryFrame === "cycle" ? "cycle" : "calendar",
	};
}

function looksLikeSettings(value: unknown): boolean {
	if (typeof value !== "object" || value === null) return false;
	const record = value as Record<string, unknown>;
	return (
		"statementDay" in record ||
		"reserve" in record ||
		"accountIds" in record ||
		"movementIds" in record ||
		"mandatoryFrame" in record
	);
}

/**
 * Reads the persist envelope plus the pre-migration raw settings object
 * (`{"statementDay":20,...}`) and legacy keys v3/v2. Writes always target
 * the primary key in envelope form.
 */
function timingStorage(): PersistStorage<TotalCycleSettings> | undefined {
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
					return sanitizeTimingSettings(record.state);
				}
				if (looksLikeSettings(parsed)) return sanitizeTimingSettings(parsed);
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
			for (const key of TIMING_LEGACY_KEYS) {
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

export type TimingResetKey =
	| "paycheck"
	| "fixed"
	| "spent"
	| "checking"
	| "remaining";

interface TimingSettingsState extends TotalCycleSettings {
	updateSettings: (next: Partial<TotalCycleSettings>) => void;
	resetConfig: (key: TimingResetKey) => void;
}

export const useTimingSettings = create<TimingSettingsState>()(
	persist(
		(set) => ({
			...defaultTimingSettings(),
			updateSettings: (next) =>
				set((previous) => ({
					statementDay: next.statementDay ?? previous.statementDay,
					statementDaySet: next.statementDaySet ?? previous.statementDaySet,
					reserve: next.reserve ?? previous.reserve,
					spentOverride:
						next.spentOverride !== undefined
							? next.spentOverride
							: previous.spentOverride,
					paycheckOverride:
						next.paycheckOverride !== undefined
							? next.paycheckOverride
							: previous.paycheckOverride,
					fixedOverride:
						next.fixedOverride !== undefined
							? next.fixedOverride
							: previous.fixedOverride,
					checkingOverride:
						next.checkingOverride !== undefined
							? next.checkingOverride
							: previous.checkingOverride,
					remainingOverride:
						next.remainingOverride !== undefined
							? next.remainingOverride
							: previous.remainingOverride,
					accountIds:
						next.accountIds !== undefined
							? next.accountIds
							: previous.accountIds,
					spendingAccountIds:
						next.spendingAccountIds !== undefined
							? next.spendingAccountIds
							: previous.spendingAccountIds,
					movementIds:
						next.movementIds !== undefined
							? next.movementIds
							: previous.movementIds,
					mandatoryFrame: next.mandatoryFrame ?? previous.mandatoryFrame,
				})),
			resetConfig: (key) =>
				set((previous) => ({
					...previous,
					[`${key}Override`]: null,
				})),
		}),
		{
			name: TIMING_STORAGE_KEY,
			version: 4,
			storage: timingStorage(),
			partialize: (state) => ({
				statementDay: state.statementDay,
				reserve: state.reserve,
				spentOverride: state.spentOverride,
				paycheckOverride: state.paycheckOverride,
				fixedOverride: state.fixedOverride,
				checkingOverride: state.checkingOverride,
				remainingOverride: state.remainingOverride,
				accountIds: state.accountIds,
				spendingAccountIds: state.spendingAccountIds,
				movementIds: state.movementIds,
				mandatoryFrame: state.mandatoryFrame,
				statementDaySet: state.statementDaySet,
			}),
			migrate: (persisted) => sanitizeTimingSettings(persisted),
			merge: (persisted, current) => ({
				...current,
				...sanitizeTimingSettings(persisted),
			}),
		},
	),
);

/** Test hook: restores timing defaults between cases. */
export function resetTimingSettings(): void {
	useTimingSettings.setState({ ...defaultTimingSettings() });
}
