import { useEffect, useMemo } from "react";
import { createApiClient } from "../api/index.ts";
import { REMOTE_STORAGE_KEY } from "./remoteStorage.ts";
import { useUiStore } from "./uiStore.ts";
import {
	type RemoteApiClient,
	type RemoteWorkspaceState,
	type UseRemoteWorkspaceOptions,
	useWorkspaceStore,
} from "./workspaceStore.ts";

export type {
	RemoteApiClient,
	RemoteWorkspace,
	RemoteWorkspaceState,
	UseRemoteWorkspaceOptions,
} from "./workspaceStore.ts";

let defaultClient: RemoteApiClient | null = null;

/// The engine lives in the workspace store; this hook binds options,
/// boots the sync on mount, and subscribes to the snapshot. Return shape is
/// unchanged: components and tests consume state and actions exactly as before.
export function useRemoteWorkspace({
	client,
	authToken,
}: UseRemoteWorkspaceOptions = {}): RemoteWorkspaceState {
	const api = useMemo(() => {
		if (client) return client;
		// Lazily-created module singleton: idempotent, so the shared client is
		// stable across hook instances without an extra provider.
		// oxlint-disable-next-line react/globals
		if (!defaultClient) defaultClient = createApiClient();
		return defaultClient;
	}, [client]);
	const uiToken = useUiStore((state) => state.authToken);
	const resolvedToken = authToken ?? uiToken;
	const bindEngine = useWorkspaceStore((state) => state.bindEngine);
	const bootWorkspace = useWorkspaceStore((state) => state.bootWorkspace);
	const shutdownWorkspace = useWorkspaceStore(
		(state) => state.shutdownWorkspace,
	);
	useEffect(() => {
		bindEngine(api, resolvedToken);
		bootWorkspace();
		return () => shutdownWorkspace();
	}, [bindEngine, bootWorkspace, shutdownWorkspace, api, resolvedToken]);
	// Narrow selectors: subscribe per field so a toast, notice, or volatile
	// write does not re-render every consumer of the whole store. Add new
	// fields as individual selectors, never by spreading the store.
	const workspace = useWorkspaceStore((state) => state.workspace);
	const status = useWorkspaceStore((state) => state.status);
	const serverDocument = useWorkspaceStore((state) => state.serverDocument);
	const serverRevision = useWorkspaceStore((state) => state.serverRevision);
	const recoveryDraft = useWorkspaceStore((state) => state.recoveryDraft);
	const incomeData = useWorkspaceStore((state) => state.incomeData);
	const adapterReport = useWorkspaceStore((state) => state.adapterReport);
	const savedPresentation = useWorkspaceStore(
		(state) => state.savedPresentation,
	);
	const draftPresentation = useWorkspaceStore(
		(state) => state.draftPresentation,
	);
	const loading = useWorkspaceStore((state) => state.loading);
	const error = useWorkspaceStore((state) => state.error);
	const notice = useWorkspaceStore((state) => state.notice);
	const volatile = useWorkspaceStore((state) => state.volatile);
	const writeBlocked = useWorkspaceStore((state) => state.writeBlocked);
	const authRequiredState = useWorkspaceStore(
		(state) => state.authRequiredState,
	);
	const updatePlan = useWorkspaceStore((state) => state.updatePlan);
	const save = useWorkspaceStore((state) => state.save);
	const discard = useWorkspaceStore((state) => state.discard);
	const reloadDraft = useWorkspaceStore((state) => state.reloadDraft);
	const replace = useWorkspaceStore((state) => state.replace);
	const capture = useWorkspaceStore((state) => state.capture);
	const importServerDocument = useWorkspaceStore(
		(state) => state.importServerDocument,
	);
	const retry = useWorkspaceStore((state) => state.retry);
	const dismissNotice = useWorkspaceStore((state) => state.dismissNotice);
	return {
		workspace,
		plan: workspace?.draft ?? workspace?.saved ?? null,
		status,
		serverDocument,
		serverRevision,
		recoveryDraft,
		incomeData,
		adapterReport,
		savedPresentation,
		draftPresentation,
		loading,
		error,
		notice,
		volatile,
		stale: Boolean(workspace?.draftStale),
		draftStale: Boolean(workspace?.draftStale),
		storageConflict: Boolean(error?.includes("changed in another tab") ?? false),
		readOnly: Boolean(status?.readOnly || writeBlocked),
		authRequired: authRequiredState,
		updatePlan,
		save,
		discard,
		reloadDraft,
		replace,
		capture,
		importServerDocument,
		retry,
		dismissNotice,
	};
}

export { REMOTE_STORAGE_KEY };
