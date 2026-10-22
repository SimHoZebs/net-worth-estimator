import type { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import { Skeleton } from "../components/ui.tsx";
import {
	WorkspaceHeading,
	WorkspaceTopbar,
} from "../workspace/WorkspaceHeader.tsx";
import { WorkspaceLayout } from "../workspace/WorkspaceLayout.tsx";
import { WorkspaceSidebar } from "../workspace/WorkspaceSidebar.tsx";

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
			header={(open) => (
				<WorkspaceTopbar
					page={navigation.currentPage}
					onOpenNavigation={open}
				/>
			)}
			draftBar={null}
			overlays={null}
			notification={null}
		>
			<WorkspaceHeading
				page={navigation.currentPage}
				headingRef={navigation.headingRef}
			/>
			<section
				className="mx-auto my-[12vh] flex max-w-156 flex-col gap-4 p-6"
				aria-busy="true"
				aria-label="Loading workspace"
			>
				<Skeleton width={240} height={22} />
				<Skeleton width={"100%"} height={12} />
				<Skeleton width={"82%"} height={12} />
				<Skeleton width={"100%"} height={220} />
				<p className="sr-only" role="status">
					Loading the saved model, status, and income snapshot.
				</p>
			</section>
		</WorkspaceLayout>
	);
}
