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
	const snapshot = useWorkspaceStore();
	const workspace = snapshot.workspace;
	return {
		workspace,
		plan: workspace?.draft ?? workspace?.saved ?? null,
		status: snapshot.status,
		serverDocument: snapshot.serverDocument,
		serverRevision: snapshot.serverRevision,
		draftDocument: snapshot.draftDocument,
		recoveryDraft: snapshot.recoveryDraft,
		incomeData: snapshot.incomeData,
		adapterReport: snapshot.adapterReport,
		savedPresentation: snapshot.savedPresentation,
		draftPresentation: snapshot.draftPresentation,
		loading: snapshot.loading,
		error: snapshot.error,
		notice: snapshot.notice,
		volatile: snapshot.volatile,
		stale: Boolean(workspace?.draftStale),
		draftStale: Boolean(workspace?.draftStale),
		storageConflict: Boolean(
			snapshot.error?.includes("changed in another tab") ?? false,
		),
		readOnly: Boolean(snapshot.status?.readOnly || snapshot.writeBlocked),
		authRequired: snapshot.authRequiredState,
		updatePlan: snapshot.updatePlan,
		save: snapshot.save,
		discard: snapshot.discard,
		reloadDraft: snapshot.reloadDraft,
		replace: snapshot.replace,
		capture: snapshot.capture,
		importServerDocument: snapshot.importServerDocument,
		retry: snapshot.retry,
		dismissNotice: snapshot.dismissNotice,
	};
}

export { REMOTE_STORAGE_KEY };
