import { useSession } from "@/auth/sessionContext.ts";
import {
	useAmountPresets,
	useServerModel,
	useServerStatus,
} from "@/state/workspaceResources.ts";
import { useUserScope } from "@/state/useUserScope.ts";
import { useWorkspaceSyncMonitor } from "@/state/useWorkspaceSyncMonitor.ts";

export function useWorkspaceStartup(): void {
	const scope = useUserScope();
	const resourceId = useSession()?.session.resource.id;
	const enabled =
		scope.status === "ready" &&
		(!resourceId || resourceId === scope.resource?.id);
	useServerModel({ enabled });
	useServerStatus({ enabled });
	useAmountPresets({ enabled });
	useWorkspaceSyncMonitor(enabled);
}
