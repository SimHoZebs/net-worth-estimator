import { Wallet } from "lucide-react";
import type { BackendCheckpoint } from "../api/contracts.ts";
import { ProjectionChart } from "../components/ProjectionChart.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import { ProjectionUpdating } from "../components/ProjectionUpdating.tsx";
import { Notice } from "../components/Notice.tsx";
import { TextButton } from "../components/Button.tsx";
import { useCurrentPosition } from "../state/useCurrentPosition.ts";
import { usePinnedEvaluations } from "../state/pinnedEvaluations.ts";
import { useUiStore } from "../state/uiStore.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { usePlan, useWorkspaceReadOnly } from "../state/useWorkspacePlan.ts";
import {
	useServerModel,
	useServerStatus,
} from "../state/workspaceResources.ts";
import { PinnedEvaluations } from "./outlook/PinnedEvaluations.tsx";
import { OutlookMetrics } from "./outlook/OutlookMetrics.tsx";
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
	const checkpoints =
		useServerModel().data?.document?.checkpoints ?? EMPTY_CHECKPOINTS;
	const plan = usePlan();
	const years = useUiStore((state) => state.years);
	const setYears = useUiStore((state) => state.setYears);
	const ranges = useUiStore((state) => state.ranges);
	const setRanges = useUiStore((state) => state.setRanges);
	const projection = useRemoteProjection({
		enabled: (plan?.accounts.length ?? 0) > 0,
	});
	const position = useCurrentPosition({
		enabled: (plan?.accounts.length ?? 0) > 0,
	});
	const {
		ids: pinnedIds,
		toggle: togglePin,
		loading: pinsLoading,
	} = usePinnedEvaluations();
	const status = useServerStatus().data;
	const writeBlocked = useWorkspaceReadOnly();
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
				description="Start with an account and its current balance. Add income, expenses, and plans at your own pace."
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
			<div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_var(--container-3xs)] xl:grid-cols-[minmax(0,1fr)_var(--container-2xs)] xl:gap-6 print:grid-cols-1!">
				<ProjectionChart
					plan={plan}
					projection={base}
					range={projection.range}
					ranges={ranges}
					setRanges={setRanges}
					years={years}
					setYears={setYears}
					progress={projection.progress}
					rangeError={projection.rangeError}
					pending={pending}
				/>
				<div className="sticky top-5 flex min-w-0 flex-col gap-4 max-lg:static">
					<OutlookMetrics
						plan={plan}
						projection={base}
						position={position}
						years={years}
						onEvidence={onEvidence}
						pending={pending}
					/>
				</div>
			</div>
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
