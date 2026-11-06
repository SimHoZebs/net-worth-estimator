import { useUiStore } from "../state/uiStore.ts";
import { useUserScope } from "../state/useUserScope.ts";
import { useServerStatus } from "../state/workspaceResources.ts";
import { useWorkspaceSyncMonitor } from "../state/useWorkspaceSyncMonitor.ts";
import { WorkspaceShell } from "../WorkspaceShell.tsx";
import { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import { ServerLoadingShell } from "./ServerLoadingShell.tsx";
import { ServerWorkspaceRecovery } from "./ServerWorkspaceRecovery.tsx";

export function ServerApp() {
	// Startup enables resource queries. Screens subscribe to their own data.
	// No fetched data travels as props anywhere in this tree.
	const enabled = useUserScope().status === "ready";
	// Presence is a status flag, not a model read. Only the projection and
	// detail views that need the document fetch it.
	const status = useServerStatus({ enabled });
	useWorkspaceSyncMonitor(enabled);
	const navigation = useWorkspaceNavigation();
	const importing = useUiStore((state) => state.importing);

	// Identity is the only gate: until the verified scope exists no request
	// can carry its resource assertion, so the boot chrome stands in. Once
	// the scope is ready the shell mounts immediately and the pages
	// skeletonize their own data slots.
	if (!enabled || importing) {
		return <ServerLoadingShell navigation={navigation} />;
	}
	// Terminal absence takes the dedicated recovery screen. A pending status
	// is a shell flag, not a reason to withhold navigation.
	if (status.data?.hasModel === false) return <ServerWorkspaceRecovery />;
	return <WorkspaceShell />;
}
