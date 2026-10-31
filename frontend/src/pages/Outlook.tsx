import { Wallet } from "lucide-react";
import { ProjectionChart } from "../components/ProjectionChart.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ProjectionUpdating } from "../components/ProjectionUpdating.tsx";
import { Notice } from "../components/Notice.tsx";
import { TextButton } from "../components/Button.tsx";
import { usePinnedEvaluations } from "../state/pinnedEvaluations.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import {
	useSavedAccounts,
	useSavedEvaluations,
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
	// OutlookContent where the queries are declared.
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
	// The page owns its own gating and global forecast status; children
	// subscribe to their own queries via the shared TanStack cache.
	const accounts = useSavedAccounts();
	const transactions = useSavedTransactions();
	const startDate = useSavedStartDate();
	const evaluations = useSavedEvaluations();
	const { ids: pinnedIds } = usePinnedEvaluations();
	const projection = useRemoteProjection({
		enabled: (accounts?.length ?? 0) > 0,
		// The chart no longer offers horizon or range switches, so Outlook
		// pins the horizon instead of inheriting possibly stale persisted
		// preferences. The stochastic range only feeds pinned threshold
		// cards, so it is requested only while one is pinned.
		years: 20,
		ranges:
			evaluations?.some((evaluation) =>
				(pinnedIds ?? []).includes(evaluation.id),
			) ?? false,
	});
	const writeBlocked = useUserReadOnly();
	// Previous-input placeholders are not forecasts for the active model.
	const base =
		projection.base instanceof Error || projection.isPlaceholderData
			? null
			: projection.base;
	const pending =
		projection.status === "pending" ||
		(projection.isPlaceholderData && projection.loading);
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
			{projection.loading && base && <ProjectionUpdating />}
			{pending && (
				<p className="sr-only" role="status">
					Loading the projection.
				</p>
			)}
			{projection.status === "error" && (
				<Notice tone="danger" className="mb-4">
					<span>Could not calculate forecast. {projection.baseError}</span>
					<TextButton onClick={projection.retryProjection}>
						Retry forecast
					</TextButton>
				</Notice>
			)}
			<ProjectionChart onEvidence={onEvidence} />
			<PinnedEvaluations />
			{(base || pending) && (
				<div className="mt-6 max-sm:mt-5" aria-busy={pending}>
					<SafeSpendingPreview
						detail={safeSpendingDetail}
						onDetail={onSafeSpendingDetail}
						onTabChange={onSafeSpendingTab}
					/>
				</div>
			)}
		</>
	);
}
