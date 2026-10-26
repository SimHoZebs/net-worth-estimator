import { useEffect, useMemo, useSyncExternalStore } from "react";
import { defaultScopedApiClient } from "../api/scopedClients.ts";
import {
	getResourceScope,
	subscribeResourceScope,
} from "../auth/resourceScope.ts";
import { useSession } from "../auth/sessionContext.ts";
import { type RemoteApiClient, useWorkspaceStore } from "./workspaceStore.ts";
import {
	useAmountPresets,
	useServerModel,
	useServerStatus,
} from "./workspaceResources.ts";
import { useWorkspaceSyncMonitor } from "./useWorkspaceSyncMonitor.ts";

export function useWorkspaceStartup({
	client,
}: { client?: RemoteApiClient } = {}): void {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	const resourceId = useSession()?.session.resource.id;
	const enabled =
		scope.status === "ready" &&
		(!resourceId || resourceId === scope.resource?.id);
	const api = useMemo(
		() =>
			scope.status === "ready" ? (client ?? defaultScopedApiClient()) : null,
		[client, scope],
	);
	const model = useServerModel({ client: api ?? undefined, enabled });
	useServerStatus({ client: api ?? undefined, enabled });
	useAmountPresets({ client: api ?? undefined, enabled });
	useWorkspaceSyncMonitor(enabled ? api : null);
	useEffect(() => {
		if (enabled) useWorkspaceStore.getState().restore(scope);
	}, [enabled, scope]);
	useEffect(() => {
		if (enabled && model.data)
			useWorkspaceStore.getState().reconcile(model.data);
	}, [enabled, model.data]);
}
