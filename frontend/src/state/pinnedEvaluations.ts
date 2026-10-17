import { create } from "zustand";
import { createApiClient, type ApiClient } from "../api/index.ts";
import { useUiStore } from "./uiStore.ts";

export interface PinnedEvaluationsState {
	/** Pinned evaluation instance IDs in pin order. Null until loaded. */
	ids: string[] | null;
	loading: boolean;
	error: string | null;
	refresh: (client?: ApiClient) => Promise<void>;
	toggle: (id: string, client?: ApiClient) => Promise<boolean>;
	reset: () => void;
}

let defaultClient: ApiClient | null = null;

function clientOrDefault(client?: ApiClient): ApiClient {
	if (client) return client;
	if (!defaultClient) defaultClient = createApiClient();
	return defaultClient;
}

function authOptions(): { authToken?: string } {
	const authToken = useUiStore.getState().authToken;
	return authToken ? { authToken } : {};
}

/**
 * Server-persisted evaluation pins. The server is the source of truth;
 * toggles apply optimistically and revert when the PUT fails. Reads stay
 * out of the TanStack projection cache: pins are mutable server state,
 * like the model and status reads.
 */
export const usePinnedEvaluationsStore = create<PinnedEvaluationsState>()(
	(set, get) => ({
		ids: null,
		loading: false,
		error: null,
		refresh: async (client) => {
			if (get().loading) return;
			set({ loading: true, error: null });
			const result =
				await clientOrDefault(client).getPinnedEvaluations(authOptions());
			if (result instanceof Error) {
				set({ loading: false, error: result.message });
				return;
			}
			set({ ids: [...result.instanceIds], loading: false });
		},
		toggle: async (id, client) => {
			const previous = get().ids ?? [];
			const next = previous.includes(id)
				? previous.filter((item) => item !== id)
				: [...previous, id];
			set({ ids: next, error: null });
			const result = await clientOrDefault(client).setPinnedEvaluations(
				next,
				authOptions(),
			);
			if (result instanceof Error) {
				set({ ids: previous, error: result.message });
				return false;
			}
			set({ ids: [...result.instanceIds] });
			return true;
		},
		reset: () => set({ ids: null, loading: false, error: null }),
	}),
);

/** Test hook: clears the module client between cases. */
export function resetPinnedEvaluationsClient(): void {
	defaultClient = null;
}
