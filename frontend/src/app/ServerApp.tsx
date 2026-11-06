import { useUserScope } from "../state/useUserScope.ts";
import { useServerStatus } from "../state/workspaceResources.ts";
import { useWorkspaceSyncMonitor } from "../state/useWorkspaceSyncMonitor.ts";
import {
	WorkspaceHeading,
	WorkspaceTopbar,
} from "../workspace/WorkspaceHeader.tsx";
import { WorkspaceLayout } from "../workspace/WorkspaceLayout.tsx";
import { WorkspaceContent } from "../workspace/WorkspaceContent.tsx";
import { WorkspaceSidebar } from "../workspace/WorkspaceSidebar.tsx";
import { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
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

	// The layout stays mounted once. Only the body switches: recovery when
	// the server holds no model, otherwise the workspace body. No state
	// shows a whole-app skeleton; each page and sidebar slot shows its own
	// skeleton while its own query is pending. A pending status is not a
	// reason to withhold navigation, and the sidebar, topbar, and heading
	// keep their identity across loading and workspace states.
	const recovery = status.data?.hasModel === false;
	return (
		<WorkspaceLayout
			navigation={(close) => (
				<WorkspaceSidebar
					page={navigation.page}
					onClose={close}
					pending={status.isPending}
				/>
			)}
			header={(open) => (
				<WorkspaceTopbar
					page={navigation.currentPage}
					onOpenNavigation={open}
				/>
			)}
		>
			{!recovery && (
				<WorkspaceHeading
					page={navigation.currentPage}
					headingRef={navigation.headingRef}
				/>
			)}
			{recovery ? (
				<ServerWorkspaceRecovery />
			) : (
				<WorkspaceContent navigation={navigation} />
			)}
		</WorkspaceLayout>
	);
}
