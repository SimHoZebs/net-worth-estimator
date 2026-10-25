import { Wallet } from "lucide-react";
import { useEffect } from "react";
import type { BackendCheckpoint } from "../api/contracts.ts";
import { ProjectionChart } from "../components/ProjectionChart.tsx";
import { EmptyState } from "../components/EmptyState.tsx";
import {
	useErrorToast,
	useProjectionToasts,
} from "../components/NotificationCenter.tsx";
import { ProjectionUpdating } from "../components/ProjectionUpdating.tsx";
import { usePinnedEvaluationsStore } from "../state/pinnedEvaluations.ts";
import { useUiStore } from "../state/uiStore.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { useWorkspaceStore, selectPlan } from "../state/workspaceStore.ts";
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
	const checkpoints = useWorkspaceStore(
		(state) => state.serverDocument?.checkpoints ?? EMPTY_CHECKPOINTS,
	);
	const plan = useWorkspaceStore(selectPlan);
	const years = useUiStore((state) => state.years);
	const setYears = useUiStore((state) => state.setYears);
	const ranges = useUiStore((state) => state.ranges);
	const setRanges = useUiStore((state) => state.setRanges);
	const projection = useRemoteProjection({
		enabled: (plan?.accounts.length ?? 0) > 0,
	});
	const pinnedIds = usePinnedEvaluationsStore((state) => state.ids);
	const refreshPins = usePinnedEvaluationsStore((state) => state.refresh);
	const togglePin = usePinnedEvaluationsStore((state) => state.toggle);
	const pinsLoading = usePinnedEvaluationsStore((state) => state.loading);
	const pinnedError = usePinnedEvaluationsStore((state) => state.error);
	const status = useWorkspaceStore((state) => state.status);
	const writeBlocked = useWorkspaceStore((state) => state.writeBlocked);
	useEffect(() => {
		void refreshPins();
	}, [refreshPins]);
	useErrorToast("evaluation-pins", pinnedError, {
		label: "Reload pins",
		onAction: () => {
			void refreshPins();
		},
	});
	const { base } = useProjectionToasts("outlook", projection, ranges);
	const pending = base === null;
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
			<div
				className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_var(--container-3xs)] xl:grid-cols-[minmax(0,1fr)_var(--container-2xs)] xl:gap-6 print:grid-cols-1!"
				aria-busy={pending}
			>
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
		</>
	);
}
