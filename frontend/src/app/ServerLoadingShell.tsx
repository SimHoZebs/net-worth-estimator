import type { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import {
	WorkspaceHeading,
	WorkspaceTopbar,
} from "../workspace/WorkspaceHeader.tsx";
import { WorkspaceLayout } from "../workspace/WorkspaceLayout.tsx";
import { WorkspaceSidebar } from "../workspace/WorkspaceSidebar.tsx";
import "../workspace/workspace.css";

/**
 * Boot chrome while the server workspace hydrates. Static chrome renders
 * exactly as in the loaded state; only slots awaiting network data show
 * skeletons. Page content is network data, so it skeletonizes wholesale
 * until the plan arrives. Terminal load failures are not handled here.
 */
export function ServerLoadingShell({
	navigation,
}: {
	navigation: ReturnType<typeof useWorkspaceNavigation>;
}) {
	return (
		<WorkspaceLayout
			navigation={(close) => (
				<WorkspaceSidebar page={navigation.page} onClose={close} pending />
			)}
			header={(open) => <WorkspaceTopbar onOpenNavigation={open} />}
			draftBar={null}
			overlays={null}
			notification={null}
		>
			<WorkspaceHeading
				page={navigation.currentPage}
				headingRef={navigation.headingRef}
			/>
			<section
				className="workspace-loading"
				aria-busy="true"
				aria-label="Loading workspace"
			>
				<span
					className="skeleton"
					style={{ width: 240, height: 22 }}
					aria-hidden="true"
				/>
				<span
					className="skeleton"
					style={{ width: "100%", height: 12 }}
					aria-hidden="true"
				/>
				<span
					className="skeleton"
					style={{ width: "82%", height: 12 }}
					aria-hidden="true"
				/>
				<span
					className="skeleton"
					style={{ width: "100%", height: 220 }}
					aria-hidden="true"
				/>
				<p className="sr-only" role="status">
					Loading the saved model, status, and income snapshot.
				</p>
			</section>
		</WorkspaceLayout>
	);
}
