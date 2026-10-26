import { useEffect, useSyncExternalStore } from "react";
import {
	getResourceScope,
	subscribeResourceScope,
} from "@/auth/resourceScope.ts";
import { useSession } from "@/auth/sessionContext.ts";
import { useWorkspaceStore } from "@/state/workspaceStore.ts";
import {
	useAmountPresets,
	useServerModel,
	useServerStatus,
} from "@/state/workspaceResources.ts";
import { useWorkspaceSyncMonitor } from "@/state/useWorkspaceSyncMonitor.ts";

export function useWorkspaceStartup(): void {
	const scope = useSyncExternalStore(subscribeResourceScope, getResourceScope);
	const resourceId = useSession()?.session.resource.id;
	const enabled =
		scope.status === "ready" &&
		(!resourceId || resourceId === scope.resource?.id);
	const model = useServerModel({ enabled });
	useServerStatus({ enabled });
	useAmountPresets({ enabled });
	useWorkspaceSyncMonitor(enabled);
	useEffect(() => {
		if (enabled) useWorkspaceStore.getState().restore(scope);
	}, [enabled, scope]);
	useEffect(() => {
		if (enabled && model.data)
			useWorkspaceStore.getState().reconcile(model.data);
	}, [enabled, model.data]);
}
