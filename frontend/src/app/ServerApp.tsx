import { useUiStore } from "../state/uiStore.ts";
import { useWorkspaceStartup } from "../state/useWorkspaceStartup.ts";
import { useServerModel } from "../state/workspaceResources.ts";
import { WorkspaceShell } from "../WorkspaceShell.tsx";
import { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import { ServerLoadingShell } from "./ServerLoadingShell.tsx";
import { ServerWorkspaceRecovery } from "./ServerWorkspaceRecovery.tsx";

export function ServerApp() {
	// Startup enables resource queries. Screens subscribe to their own data.
	// No fetched data travels as props anywhere in this tree.
	useWorkspaceStartup();
	const navigation = useWorkspaceNavigation();
	const model = useServerModel();
	const hasModel = model.data?.model != null;
	const loading = model.isPending;
	const importing = useUiStore((state) => state.importing);

	// Transient waits render the shell chrome with a loading panel so
	// navigation stays usable. Only terminal load failures reach the
	// dedicated recovery screen.
	if (!hasModel) {
		if (loading || importing)
			return <ServerLoadingShell navigation={navigation} />;
		return <ServerWorkspaceRecovery />;
	}
	return <WorkspaceShell />;
}
