import { useEffect, useMemo } from "react";
import { createApiClient } from "../api/index.ts";
import { useUiStore } from "./uiStore.ts";
import { type RemoteApiClient, useWorkspaceStore } from "./workspaceStore.ts";

interface WorkspaceStartupOptions {
	client?: RemoteApiClient;
	authToken?: string;
}

let defaultClient: RemoteApiClient | null = null;

/** Bind and boot the store engine. Screens subscribe to their own state. */
export function useWorkspaceStartup({
	client,
	authToken,
}: WorkspaceStartupOptions = {}): void {
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
}
