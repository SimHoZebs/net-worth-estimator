import { useEffect, useMemo, useSyncExternalStore } from "react";
import { defaultScopedApiClient } from "../api/scopedClients.ts";
import {
	getResourceScope,
	subscribeResourceScope,
} from "../auth/resourceScope.ts";
import { useSession } from "../auth/sessionContext.ts";
import { type RemoteApiClient, useWorkspaceStore } from "./workspaceStore.ts";
import { useWorkspaceSyncMonitor } from "./useWorkspaceSyncMonitor.ts";

interface WorkspaceStartupOptions {
	client?: RemoteApiClient;
}

const defaultClient = defaultScopedApiClient;

/** Bind and boot the store engine. Screens subscribe to their own state. */
export function useWorkspaceStartup({
	client,
}: WorkspaceStartupOptions = {}): void {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	const resourceId = useSession()?.session.resource.id;
	const api = useMemo(() => {
		// The session boundary publishes a new owner after its preferences load.
		if (
			scope.status !== "ready" ||
			(resourceId && resourceId !== scope.resource?.id)
		)
			return null;
		return client ?? defaultClient();
	}, [client, scope, resourceId]);
	useWorkspaceSyncMonitor(api);
	const bindEngine = useWorkspaceStore((state) => state.bindEngine);
	const bootWorkspace = useWorkspaceStore((state) => state.bootWorkspace);
	const shutdownWorkspace = useWorkspaceStore(
		(state) => state.shutdownWorkspace,
	);
	useEffect(() => {
		if (!api) return;
		bindEngine(api);
		bootWorkspace();
		return () => shutdownWorkspace();
	}, [bindEngine, bootWorkspace, shutdownWorkspace, api, scope]);
}
