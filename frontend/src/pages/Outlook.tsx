import { Wallet } from "lucide-react";
import { ProjectionChart } from "../components/ProjectionChart.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty.tsx";
import { useSavedAccounts } from "../state/savedState.ts";
import { useUserReadOnly } from "../state/useUserScope.ts";
import { useWorkspaceOverlays } from "../workspace/useWorkspaceOverlays.ts";
import { PinnedEvaluations } from "./outlook/PinnedEvaluations.tsx";
import { SafeSpendingPreview } from "./outlook/safe-spending/SafeSpendingPreview.tsx";

export function Outlook() {
	// The route renders this page directly; overlay actions subscribe
	// through the workspace hooks where they are used.
	return <OutlookContent />;
}

function OutlookContent() {
	// Overlay actions subscribe where they are used. Saved rows arrive
	// through the row hooks; null means not loaded yet, [] means loaded
	// blank.
	//
	// The sections mount immediately and reserve their own slots. Gating the
	// whole page on all three row sources would mount their hooks in a second
	// wave after data arrives, and every "always" refetch policy would then
	// duplicate the first request.
	const overlays = useWorkspaceOverlays();
	const accounts = useSavedAccounts();
	const writeBlocked = useUserReadOnly();
	if (accounts && accounts.length === 0) {
		const readOnly = writeBlocked;
		return (
			<Empty className="flex-initial gap-0 px-6 py-12">
				<EmptyHeader>
					<EmptyMedia>
						<span className="mb-5 grid size-16 place-items-center rounded-full bg-success-bg text-success-text">
							<Wallet size={28} />
						</span>
					</EmptyMedia>
					<EmptyTitle>
						<h3 className="text-lg">Your workspace is ready</h3>
					</EmptyTitle>
					<EmptyDescription className="mt-2 mb-5 max-w-sm text-muted">
						Start with an account and its current balance. Add income, expenses,
						and goals at your own pace.
					</EmptyDescription>
				</EmptyHeader>
				{!readOnly && (
					<EmptyContent>
						<Button
							type="button"
							variant="default"
							onClick={() =>
								overlays.openEditor({ kind: "account", item: null })
							}
						>
							Add your first account
						</Button>
					</EmptyContent>
				)}
			</Empty>
		);
	}
	return (
		<>
			<SafeSpendingPreview
				detail={overlays.safeSpendingDetail}
				onDetail={(tab) => {
					if (tab) overlays.openSafeSpendingDetail(tab);
					else overlays.closeSafeSpendingDetail();
				}}
				onTabChange={overlays.switchSafeSpendingTab}
			/>
			<div className="mt-6 max-sm:mt-5">
				<ProjectionChart
					onEvidence={() => overlays.openEvidence({ kind: "position" })}
				/>
			</div>
			<PinnedEvaluations />
		</>
	);
}
