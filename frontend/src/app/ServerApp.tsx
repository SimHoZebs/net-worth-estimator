import { useUiStore } from "../state/uiStore.ts";
import { useRemoteWorkspace } from "../state/useRemoteWorkspace.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";
import { WorkspaceShell } from "../WorkspaceShell.tsx";
import { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import { ServerLoadingShell } from "./ServerLoadingShell.tsx";
import { ServerWorkspaceRecovery } from "./ServerWorkspaceRecovery.tsx";
import "./app.css";

export function ServerApp() {
	// The engine boots here; everything below subscribes to the stores.
	// No fetched data travels as props anywhere in this tree.
	useRemoteWorkspace();
	const navigation = useWorkspaceNavigation();
	const workspace = useWorkspaceStore((state) => state.workspace);
	const plan = workspace?.draft ?? workspace?.saved ?? null;
	const loading = useWorkspaceStore((state) => state.loading);
	const importing = useUiStore((state) => state.importing);

	// Transient waits render the shell chrome with a loading panel so
	// navigation stays usable. Only terminal load failures reach the
	// dedicated recovery screen.
	if (!workspace || !plan) {
		if (loading || importing)
			return <ServerLoadingShell navigation={navigation} />;
		return <ServerWorkspaceRecovery />;
	}
	return <WorkspaceShell />;
}
