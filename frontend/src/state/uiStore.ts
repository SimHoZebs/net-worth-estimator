import { create } from "zustand";

/**
 * Local interface state: projection horizon, scenario bands, and the bearer
 * token (kept in memory only, never persisted). These are query inputs, so
 * they live in the store rather than traveling as props: consuming
 * components subscribe where the query is declared.
 */
interface UiState {
	years: number;
	ranges: boolean;
	authToken: string;
	importing: boolean;
	setYears: (years: number) => void;
	setRanges: (ranges: boolean) => void;
	setAuthToken: (authToken: string) => void;
	setImporting: (importing: boolean) => void;
}

export const useUiStore = create<UiState>()((set) => ({
	years: 20,
	ranges: true,
	authToken: "",
	importing: false,
	setYears: (years) => set({ years }),
	setRanges: (ranges) => set({ ranges }),
	setAuthToken: (authToken) => set({ authToken }),
	setImporting: (importing) => set({ importing }),
}));

/** Test hook: restores default interface state between cases. */
export function resetUiStore(): void {
	useUiStore.setState({
		years: 20,
		ranges: true,
		authToken: "",
		importing: false,
	});
}
