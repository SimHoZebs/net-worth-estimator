import { Wallet } from "lucide-react";
import { ProjectionChart } from "../components/ProjectionChart.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty.tsx";
import { useSavedAccounts } from "../state/savedState.ts";
import { useAccountBalances } from "../state/workspaceResources.ts";
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
	const balances = useAccountBalances();
	const writeBlocked = useUserReadOnly();
	const balancesFailed = balances.isError || balances.isRefetchError;
	const balancesError =
		balancesFailed && balances.error ? (
			<Alert variant="destructive" aria-label="Outlook account balances">
				<AlertDescription>
					Account balances could not be loaded. {balances.error.message}
				</AlertDescription>
				<Button variant="link" onClick={() => void balances.refetch()}>
					Retry
				</Button>
			</Alert>
		) : null;
	// A failed prerequisite is not pending. Keep cached content on refresh
	// failures, but do not leave disabled forecasts skeletonizing on first load.
	if (balancesError && !balances.data) return balancesError;
	if (accounts && accounts.length === 0) {
		const readOnly = writeBlocked;
		return (
			<Empty>
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<Wallet aria-hidden="true" />
					</EmptyMedia>
					<EmptyTitle>Your workspace is ready</EmptyTitle>
					<EmptyDescription>
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
			{balancesError}
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
