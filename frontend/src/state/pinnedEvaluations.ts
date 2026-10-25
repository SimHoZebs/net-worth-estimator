import { create } from "zustand";
import { type ApiClient } from "../api/index.ts";
import { defaultScopedApiClient } from "../api/scopedClients.ts";
import {
	getResourceScope,
	subscribeResourceScope,
} from "../auth/resourceScope.ts";

export interface PinnedEvaluationsState {
	/** Pinned evaluation instance IDs in pin order. Null until loaded. */
	ids: string[] | null;
	loading: boolean;
	error: string | null;
	refresh: (client?: ApiClient, force?: boolean) => Promise<void>;
	toggle: (id: string, client?: ApiClient) => Promise<boolean>;
	reset: () => void;
}

function clientOrDefault(client?: ApiClient): ApiClient {
	if (client) return client;
	return defaultScopedApiClient();
}

// Last successful fetch per scope key so two mounted pages sharing one refresh
// do not issue duplicate GETs. `force` bypasses the TTL after a toggle; an
// errored state always refetches so the Reload action cannot be swallowed.
let lastFetchedAt = 0;
let lastFetchedScope: string | null = null;
const PINS_TTL_MS = 30_000;

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
		refresh: async (client, force = false) => {
			const scope = getResourceScope();
			if (scope.status === "pending") return;
			if (get().loading) return;
			if (
				!force &&
				get().ids !== null &&
				get().error === null &&
				scope.key === lastFetchedScope &&
				Date.now() - lastFetchedAt < PINS_TTL_MS
			)
				return;
			set({ loading: true, error: null });
			const result = await clientOrDefault(client).getPinnedEvaluations();
			if (scope !== getResourceScope()) return;
			if (result instanceof Error) {
				set({ loading: false, error: result.message });
				return;
			}
			lastFetchedAt = Date.now();
			lastFetchedScope = scope.key;
			set({ ids: [...result.instanceIds], loading: false });
		},
		toggle: async (id, client) => {
			const scope = getResourceScope();
			if (scope.status === "pending") return false;
			const previous = get().ids ?? [];
			const next = previous.includes(id)
				? previous.filter((item) => item !== id)
				: [...previous, id];
			set({ ids: next, error: null });
			const result = await clientOrDefault(client).setPinnedEvaluations(next);
			if (scope !== getResourceScope()) return false;
			if (result instanceof Error) {
				set({ ids: previous, error: result.message });
				return false;
			}
			lastFetchedAt = Date.now();
			lastFetchedScope = scope.key;
			set({ ids: [...result.instanceIds] });
			return true;
		},
		reset: () => {
			lastFetchedAt = 0;
			lastFetchedScope = null;
			set({ ids: null, loading: false, error: null });
		},
	}),
);

subscribeResourceScope(() => usePinnedEvaluationsStore.getState().reset());

/** Test hook: clears the pins TTL between cases (client is now shared). */
export function resetPinnedEvaluationsClient(): void {
	lastFetchedAt = 0;
	lastFetchedScope = null;
}
