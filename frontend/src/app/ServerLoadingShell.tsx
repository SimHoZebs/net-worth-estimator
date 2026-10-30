import type { useWorkspaceNavigation } from "../workspace/useWorkspaceNavigation.ts";
import { Skeleton } from "../components/Skeleton.tsx";
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
 * until the account arrives. Terminal load failures are not handled here.
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
			overlays={null}
		>
			<WorkspaceHeading
				page={navigation.currentPage}
				headingRef={navigation.headingRef}
			/>
			<section
				className="mx-auto my-[12vh] flex max-w-2xl flex-col gap-4 p-6"
				aria-busy="true"
				aria-label="Loading workspace"
			>
				<Skeleton className="h-6 w-60" />
				<Skeleton className="h-3 w-full" />
				<Skeleton className="h-3 w-5/6" />
				<Skeleton className="h-56 w-full" />
				<p className="sr-only" role="status">
					Loading your saved data.
				</p>
			</section>
		</WorkspaceLayout>
	);
}
