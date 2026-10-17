import { useBeforeUnload } from "./state/useBeforeUnload.ts";
import { DraftBar } from "./workspace/DraftBar.tsx";
import type { TimingDetailTab } from "./pages/outlook/TimingDetailDialog.tsx";
import "./workspace/workspace.css";
import { useWorkspaceStore } from "./state/workspaceStore.ts";
import { useWorkspaceNavigation } from "./workspace/useWorkspaceNavigation.ts";
import { useWorkspaceOverlays } from "./workspace/useWorkspaceOverlays.ts";
import {
	WorkspaceDialogs,
	WorkspaceEvidence,
} from "./workspace/WorkspaceDialogs.tsx";
import {
	WorkspaceHeading,
	WorkspaceTopbar,
} from "./workspace/WorkspaceHeader.tsx";
import { WorkspaceLayout } from "./workspace/WorkspaceLayout.tsx";
import {
	WorkspaceNotices,
	WorkspaceNotification,
} from "./workspace/WorkspaceNotices.tsx";
import { WorkspacePage } from "./workspace/WorkspacePage.tsx";
import { WorkspaceSidebar } from "./workspace/WorkspaceSidebar.tsx";

// The shell owns only local interface state (navigation, overlays). Every
// data display subscribes to the stores; this component takes no props.
export function WorkspaceShell() {
	const navigation = useWorkspaceNavigation();
	const volatile = useWorkspaceStore((state) => state.volatile);
	const discard = useWorkspaceStore((state) => state.discard);
	const overlays = useWorkspaceOverlays({
		discard,
		route: navigation.route,
		pushHash: navigation.pushHash,
		replaceHash: navigation.replaceHash,
	});
	useBeforeUnload(volatile);
	const timingDetail = (tab: TimingDetailTab | null) => {
		if (tab) overlays.openTimingDetail(tab);
		else overlays.closeTimingDetail();
	};
	// DraftBar runs its own save against the store; only the discard overlay
	// stays a prop.
	return (
		<WorkspaceLayout
			navigation={(close) => (
				<WorkspaceSidebar page={navigation.page} onClose={close} />
			)}
			header={(open) => <WorkspaceTopbar onOpenNavigation={open} />}
			draftBar={<DraftBar onDiscard={overlays.openDiscard} />}
			overlays={<WorkspaceDialogs overlays={overlays} />}
			notification={<WorkspaceNotification />}
		>
			<WorkspaceHeading
				page={navigation.currentPage}
				headingRef={navigation.headingRef}
			/>
			<WorkspaceNotices />
			<WorkspacePage
				page={navigation.page}
				onEdit={overlays.openEditor}
				onEvidence={overlays.openEvidence}
				onNavigate={navigation.navigate}
				timingDetail={overlays.timingDetail}
				onTimingDetail={timingDetail}
				onTimingTab={overlays.switchTimingTab}
			/>
			<WorkspaceEvidence overlays={overlays} />
		</WorkspaceLayout>
	);
}
