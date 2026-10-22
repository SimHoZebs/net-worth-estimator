import { useEffect, useMemo } from "react";
import { createApiClient } from "../api/index.ts";
import { resourceScopedFactory } from "../api/scopedRequest.ts";
import { type RemoteApiClient, useWorkspaceStore } from "./workspaceStore.ts";

interface WorkspaceStartupOptions {
	client?: RemoteApiClient;
}

const defaultClient = resourceScopedFactory(createApiClient);

/** Bind and boot the store engine. Screens subscribe to their own state. */
export function useWorkspaceStartup({
	client,
}: WorkspaceStartupOptions = {}): void {
	const api = useMemo(() => {
		if (client) return client;
		return defaultClient();
	}, [client]);
	const bindEngine = useWorkspaceStore((state) => state.bindEngine);
	const bootWorkspace = useWorkspaceStore((state) => state.bootWorkspace);
	const shutdownWorkspace = useWorkspaceStore(
		(state) => state.shutdownWorkspace,
	);
	useEffect(() => {
		bindEngine(api);
		bootWorkspace();
		return () => shutdownWorkspace();
	}, [bindEngine, bootWorkspace, shutdownWorkspace, api]);
}
