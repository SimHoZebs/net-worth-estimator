import { create } from "zustand";
import { persist } from "zustand/middleware";
import { appJsonStorage, UI_PREFS_STORAGE_KEY } from "./persisted.ts";

/**
 * Local interface state: projection horizon and scenario bands. These are query inputs, so
 * they live in the store rather than traveling as props: consuming
 * components subscribe where the query is declared.
 */
interface UiState {
	years: number;
	ranges: boolean;
	importing: boolean;
	setYears: (years: number) => void;
	setRanges: (ranges: boolean) => void;
	setImporting: (importing: boolean) => void;
}

type UiPrefs = Pick<UiState, "years" | "ranges">;

const UI_DEFAULTS: UiPrefs = { years: 20, ranges: true };

function sanitizeUiPrefs(value: unknown): UiPrefs {
	if (typeof value !== "object" || value === null) return { ...UI_DEFAULTS };
	const record = value as Record<string, unknown>;
	const years =
		typeof record.years === "number" &&
		Number.isFinite(record.years) &&
		record.years > 0
			? Math.min(100, Math.floor(record.years))
			: UI_DEFAULTS.years;
	const ranges =
		typeof record.ranges === "boolean" ? record.ranges : UI_DEFAULTS.ranges;
	return { years, ranges };
}

export const useUiStore = create<UiState>()(
	persist(
		(set) => ({
			...UI_DEFAULTS,
			importing: false,
			setYears: (years) => set({ years }),
			setRanges: (ranges) => set({ ranges }),
			setImporting: (importing) => set({ importing }),
		}),
		{
			name: UI_PREFS_STORAGE_KEY,
			version: 1,
			storage: appJsonStorage<UiPrefs>(),
			partialize: (state) => ({ years: state.years, ranges: state.ranges }),
			migrate: (persisted) => sanitizeUiPrefs(persisted),
			merge: (persisted, current) => ({
				...current,
				...sanitizeUiPrefs(persisted),
			}),
		},
	),
);

/** Test hook: restores default interface state between cases. */
export function resetUiStore(): void {
	useUiStore.setState({
		years: 20,
		ranges: true,
		importing: false,
	});
}
