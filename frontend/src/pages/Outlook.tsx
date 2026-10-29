import { Wallet } from "lucide-react";
import type { BackendCheckpoint } from "../api/contracts.ts";
import { ProjectionChart } from "../components/ProjectionChart.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ProjectionUpdating } from "../components/ProjectionUpdating.tsx";
import { Notice } from "../components/Notice.tsx";
import { TextButton } from "../components/Button.tsx";
import { usePinnedEvaluations } from "../state/pinnedEvaluations.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import {
	useAccountPlan,
	useAccountReadOnly,
} from "../state/useAccountScope.ts";
import {
	useCheckpoints,
	useServerStatus,
} from "../state/workspaceResources.ts";
import { PinnedEvaluations } from "./outlook/PinnedEvaluations.tsx";
import type { SafeSpendingDetailTab } from "./outlook/safe-spending/safeSpendingDetailModel.ts";
import { SafeSpendingPreview } from "./outlook/safe-spending/SafeSpendingPreview.tsx";

const EMPTY_CHECKPOINTS: BackendCheckpoint[] = [];

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
	// Every data input subscribes where the query is declared; only UI
	// callbacks arrive as props.
	const checkpoints = useCheckpoints().data?.checkpoints ?? EMPTY_CHECKPOINTS;
	const plan = useAccountPlan();
	const {
		ids: pinnedIds,
		toggle: togglePin,
		loading: pinsLoading,
	} = usePinnedEvaluations();
	const projection = useRemoteProjection({
		enabled: (plan?.accounts.length ?? 0) > 0,
		// The chart no longer offers horizon or range switches, so Outlook
		// pins the horizon instead of inheriting possibly stale persisted
		// preferences. The stochastic range only feeds pinned threshold
		// cards, so it is requested only while one is pinned.
		years: 20,
		ranges:
			plan?.evaluations.some((evaluation) =>
				(pinnedIds ?? []).includes(evaluation.id),
			) ?? false,
	});
	const status = useServerStatus().data;
	const writeBlocked = useAccountReadOnly();
	// Previous-input placeholders are not forecasts for the active model.
	const base =
		projection.base instanceof Error || projection.isPlaceholderData
			? null
			: projection.base;
	const pending =
		projection.status === "pending" ||
		(projection.isPlaceholderData && projection.loading);
	if (!plan) return null;
	if (plan.accounts.length === 0) {
		const readOnly = plan.readOnly || status?.readOnly || writeBlocked;
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
			<ProjectionChart
				projection={base}
				onEvidence={onEvidence}
				pending={pending}
			/>
			<PinnedEvaluations
				plan={plan}
				projection={base}
				range={projection.range}
				pinnedIds={pinnedIds}
				pending={pending}
				pinsDisabled={pinsLoading || (status?.readOnly ?? false)}
				onPinChange={(id) => {
					void togglePin(id);
				}}
			/>
			{(base || pending) && (
				<div className="mt-6 max-sm:mt-5" aria-busy={pending}>
					<SafeSpendingPreview
						plan={plan}
						checkpoints={checkpoints}
						projection={base}
						pending={pending}
						detail={safeSpendingDetail}
						onDetail={onSafeSpendingDetail}
						onTabChange={onSafeSpendingTab}
					/>
				</div>
			)}
		</>
	);
}
