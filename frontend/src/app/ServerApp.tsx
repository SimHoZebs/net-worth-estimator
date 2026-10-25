import { useUiStore } from "../state/uiStore.ts";
import { useWorkspaceStartup } from "../state/useWorkspaceStartup.ts";
import { selectPlan, useWorkspaceStore } from "../state/workspaceStore.ts";
import { WorkspaceShell } from "../WorkspaceShell.tsx";
import { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import { ServerLoadingShell } from "./ServerLoadingShell.tsx";
import { ServerWorkspaceRecovery } from "./ServerWorkspaceRecovery.tsx";

export function ServerApp() {
	// The engine boots here; everything below subscribes to the stores.
	// No fetched data travels as props anywhere in this tree.
	useWorkspaceStartup();
	const navigation = useWorkspaceNavigation();
	const hasPlan = useWorkspaceStore((state) => selectPlan(state) != null);
	const loading = useWorkspaceStore((state) => state.loading);
	const importing = useUiStore((state) => state.importing);

	// Transient waits render the shell chrome with a loading panel so
	// navigation stays usable. Only terminal load failures reach the
	// dedicated recovery screen.
	if (!hasPlan) {
		if (loading || importing)
			return <ServerLoadingShell navigation={navigation} />;
		return <ServerWorkspaceRecovery />;
	}
	return <WorkspaceShell />;
}
