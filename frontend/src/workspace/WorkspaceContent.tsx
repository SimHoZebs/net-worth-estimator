import type { SafeSpendingDetailTab } from "../pages/outlook/safe-spending/safeSpendingDetailModel.ts";
import { Suspense } from "react";
import { useWorkspaceOverlays } from "./useWorkspaceOverlays.ts";
import type { useWorkspaceNavigation } from "./useWorkspaceNavigation.ts";
import { WorkspaceDialogs, WorkspaceEvidence } from "./WorkspaceDialogs.tsx";
import { WorkspacePage } from "./WorkspacePage.tsx";

// The loaded page body. Mounts only after the verified scope exists and
// a model is present, so overlay hooks that resolve against saved rows
// never run while those rows are gated. The layout stays mounted
// across the transition; only this body swaps.
export function WorkspaceContent({
	navigation,
}: {
	navigation: ReturnType<typeof useWorkspaceNavigation>;
}) {
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
		<>
			<Suspense fallback={null}>
				<WorkspacePage
					page={navigation.page}
					onEdit={overlays.openEditor}
					onEvidence={overlays.openEvidence}
					onNavigate={navigation.navigate}
					safeSpendingDetail={overlays.safeSpendingDetail}
					onSafeSpendingDetail={safeSpendingDetail}
					onSafeSpendingTab={overlays.switchSafeSpendingTab}
				/>
			</Suspense>
			<WorkspaceEvidence overlays={overlays} />
			<WorkspaceDialogs overlays={overlays} />
		</>
	);
}
