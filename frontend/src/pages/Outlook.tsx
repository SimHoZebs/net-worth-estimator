import { Wallet } from "lucide-react";
import { ProjectionChart } from "../components/ProjectionChart.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import {
	useSavedAccounts,
	useSavedStartDate,
	useSavedTransactions,
} from "../state/savedRows.ts";
import { useUserReadOnly } from "../state/useUserScope.ts";
import { PinnedEvaluations } from "./outlook/PinnedEvaluations.tsx";
import type { SafeSpendingDetailTab } from "./outlook/safe-spending/safeSpendingDetailModel.ts";
import { SafeSpendingPreview } from "./outlook/safe-spending/SafeSpendingPreview.tsx";

type OutlookProps = {
	onAddAccount: () => void;
	onEvidence: () => void;
	onFailure: () => void;
	onTransactions: () => void;
	safeSpendingDetail: SafeSpendingDetailTab | null;
	onSafeSpendingDetail: (tab: SafeSpendingDetailTab | null) => void;
	onSafeSpendingTab: (tab: SafeSpendingDetailTab) => void;
};

export function Outlook({
	onAddAccount,
	onEvidence,
	onFailure,
	onTransactions,
	safeSpendingDetail,
	onSafeSpendingDetail,
	onSafeSpendingTab,
}: OutlookProps) {
	// Only UI callbacks arrive as props; data subscriptions live in
	// the components that use the data.
	return (
		<OutlookContent
			onAddAccount={onAddAccount}
			onEvidence={onEvidence}
			onFailure={onFailure}
			onTransactions={onTransactions}
			safeSpendingDetail={safeSpendingDetail}
			onSafeSpendingDetail={onSafeSpendingDetail}
			onSafeSpendingTab={onSafeSpendingTab}
		/>
	);
}

function OutlookContent({
	onAddAccount,
	onEvidence,
	safeSpendingDetail,
	onSafeSpendingDetail,
	onSafeSpendingTab,
}: OutlookProps) {
	// Every data input subscribes where it is used; only UI
	// callbacks arrive as props. Saved rows arrive through the row hooks;
	// null means not loaded yet, [] means loaded blank.
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const startDate = useSavedStartDate();
	const writeBlocked = useUserReadOnly();
	if (!accounts || !transactions || !startDate) return null;
	if (accounts.length === 0) {
		const readOnly = writeBlocked;
		return (
			<EmptyState
				icon={Wallet}
				title="Your workspace is ready"
				description="Start with an account and its current balance. Add income, expenses, and goals at your own pace."
				action={readOnly ? undefined : "Add your first account"}
				onAction={onAddAccount}
			/>
		);
	}
	return (
		<>
			<ProjectionChart onEvidence={onEvidence} />
			<PinnedEvaluations />
			<div className="mt-6 max-sm:mt-5">
				<SafeSpendingPreview
					detail={safeSpendingDetail}
					onDetail={onSafeSpendingDetail}
					onTabChange={onSafeSpendingTab}
				/>
			</div>
		</>
	);
}
