import { useCallback, useMemo, useRef, useState } from "react";
import { createApiClient, type ApiClient } from "../api/index.ts";
import { useUiStore } from "../state/uiStore.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";

type SyncTriggerClient = Pick<ApiClient, "triggerSimpleFIN">;

/** Manual SimpleFIN sync for the sidebar. The trigger endpoint guards
 * concurrency and spacing itself; a second press while one runs surfaces
 * the server's refusal as an inline message. */
export function useSyncNow({ client }: { client?: SyncTriggerClient } = {}) {
	const api = useMemo(() => client ?? createApiClient(), [client]);
	const authToken = useUiStore((state) => state.authToken);
	const refreshStatus = useWorkspaceStore((state) => state.refreshStatus);
	const [syncing, setSyncing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const inFlight = useRef(false);

	const syncNow = useCallback(async (): Promise<boolean> => {
		if (inFlight.current) return false;
		inFlight.current = true;
		setSyncing(true);
		setError(null);
		try {
			const result = await api.triggerSimpleFIN(authToken ? { authToken } : {});
			if (result instanceof Error) {
				setError(result.message);
				return false;
			}
			await refreshStatus();
			return true;
		} finally {
			inFlight.current = false;
			setSyncing(false);
		}
	}, [api, authToken, refreshStatus]);

	return { syncing, error, syncNow };
}
