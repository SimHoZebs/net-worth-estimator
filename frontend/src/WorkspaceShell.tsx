import type { SafeSpendingDetailTab } from "./pages/outlook/safe-spending/safeSpendingDetailModel.ts";
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
import { WorkspacePage } from "./workspace/WorkspacePage.tsx";
import { WorkspaceSidebar } from "./workspace/WorkspaceSidebar.tsx";

// The shell owns only local interface state (navigation, overlays). Every
// data display subscribes to the stores; this component takes no props.
export function WorkspaceShell() {
	const navigation = useWorkspaceNavigation();
	const overlays = useWorkspaceOverlays({
		route: navigation.route,
		returnTo: navigation.returnTo,
		pushHash: navigation.pushHash,
		replaceHash: navigation.replaceHash,
	});
	const safeSpendingDetail = (tab: SafeSpendingDetailTab | null) => {
		if (tab) overlays.openSafeSpendingDetail(tab);
		else overlays.closeSafeSpendingDetail();
	};
	return (
		<WorkspaceLayout
			navigation={(close) => (
				<WorkspaceSidebar page={navigation.page} onClose={close} />
			)}
			header={(open) => (
				<WorkspaceTopbar
					page={navigation.currentPage}
					onOpenNavigation={open}
				/>
			)}
			overlays={<WorkspaceDialogs overlays={overlays} />}
		>
			<WorkspaceHeading
				page={navigation.currentPage}
				headingRef={navigation.headingRef}
			/>
			<WorkspacePage
				page={navigation.page}
				onEdit={overlays.openEditor}
				onEvidence={overlays.openEvidence}
				onNavigate={navigation.navigate}
				safeSpendingDetail={overlays.safeSpendingDetail}
				onSafeSpendingDetail={safeSpendingDetail}
				onSafeSpendingTab={overlays.switchSafeSpendingTab}
			/>
			<WorkspaceEvidence overlays={overlays} />
		</WorkspaceLayout>
	);
}
