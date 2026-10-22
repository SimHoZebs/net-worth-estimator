import { useEffect } from "react";
import type { BackendCheckpoint } from "../api/contracts.ts";
import { ProjectionChart } from "../components/ProjectionChart.tsx";
import { ErrorNotice, ProjectionUpdating } from "../components/ui.tsx";
import type { Projection } from "../domain/result.ts";
import { usePinnedEvaluationsStore } from "../state/pinnedEvaluations.ts";
import { useUiStore } from "../state/uiStore.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";
import { PinnedEvaluations } from "./outlook/PinnedEvaluations.tsx";
import { OutlookMetrics } from "./outlook/OutlookMetrics.tsx";
import type { SafeSpendingDetailTab } from "./outlook/safe-spending/safeSpendingDetailModel.ts";
import { SafeSpendingPreview } from "./outlook/safe-spending/SafeSpendingPreview.tsx";

const EMPTY_CHECKPOINTS: BackendCheckpoint[] = [];

type OutlookProps = {
	onEvidence: () => void;
	onFailure: () => void;
	onTransactions: () => void;
	onEvaluation: (id: string) => void;
	safeSpendingDetail: SafeSpendingDetailTab | null;
	onSafeSpendingDetail: (tab: SafeSpendingDetailTab | null) => void;
	onSafeSpendingTab: (tab: SafeSpendingDetailTab) => void;
};

export function Outlook({
	onEvidence,
	onFailure,
	onTransactions,
	onEvaluation,
	safeSpendingDetail,
	onSafeSpendingDetail,
	onSafeSpendingTab,
}: OutlookProps) {
	// Only UI callbacks arrive as props; data subscriptions live in
	// OutlookContent where the queries are declared.
	return (
		<OutlookContent
			onEvidence={onEvidence}
			onFailure={onFailure}
			onTransactions={onTransactions}
			onEvaluation={onEvaluation}
			safeSpendingDetail={safeSpendingDetail}
			onSafeSpendingDetail={onSafeSpendingDetail}
			onSafeSpendingTab={onSafeSpendingTab}
		/>
	);
}

function OutlookContent({
	onEvidence,
	onEvaluation,
	safeSpendingDetail,
	onSafeSpendingDetail,
	onSafeSpendingTab,
}: OutlookProps) {
	// Every data input subscribes where the query is declared; only UI
	// callbacks arrive as props.
	const workspace = useWorkspaceStore((state) => state.workspace);
	const checkpoints = useWorkspaceStore(
		(state) => state.serverDocument?.checkpoints ?? EMPTY_CHECKPOINTS,
	);
	const plan = workspace?.draft ?? workspace?.saved ?? null;
	const years = useUiStore((state) => state.years);
	const setYears = useUiStore((state) => state.setYears);
	const ranges = useUiStore((state) => state.ranges);
	const setRanges = useUiStore((state) => state.setRanges);
	const projection = useRemoteProjection();
	const pinnedIds = usePinnedEvaluationsStore((state) => state.ids);
	const refreshPins = usePinnedEvaluationsStore((state) => state.refresh);
	const togglePin = usePinnedEvaluationsStore((state) => state.toggle);
	const pinsLoading = usePinnedEvaluationsStore((state) => state.loading);
	const pinnedError = usePinnedEvaluationsStore((state) => state.error);
	const status = useWorkspaceStore((state) => state.status);
	useEffect(() => {
		void refreshPins();
	}, [refreshPins]);
	const baseLoadError =
		projection.base instanceof Error && !projection.loading
			? projection.base
			: null;
	const base: Projection | null =
		projection.base instanceof Error ? null : projection.base;
	const pending = base === null;
	if (!plan) return null;
	if (base === null && !pending) {
		return (
			<>
				{baseLoadError && (
					<ErrorNotice
						message={baseLoadError.message}
						action="Retry calculation"
						onAction={projection.retryProjection}
					/>
				)}
				{projection.baseError && base && (
					<ErrorNotice
						message={projection.baseError}
						action="Retry calculation"
						onAction={projection.retryProjection}
					/>
				)}
				{projection.rangeError && ranges && (
					<ErrorNotice
						message={projection.rangeError}
						action="Retry scenario calculation"
						onAction={projection.retryRange}
					/>
				)}
				{projection.loading && base && <ProjectionUpdating />}
			</>
		);
	}
	return (
		<>
			{baseLoadError && (
				<ErrorNotice
					message={baseLoadError.message}
					action="Retry calculation"
					onAction={projection.retryProjection}
				/>
			)}
			{projection.baseError && base && (
				<ErrorNotice
					message={projection.baseError}
					action="Retry calculation"
					onAction={projection.retryProjection}
				/>
			)}
			{projection.rangeError && ranges && (
				<ErrorNotice
					message={projection.rangeError}
					action="Retry scenario calculation"
					onAction={projection.retryRange}
				/>
			)}
			{projection.loading && base && <ProjectionUpdating />}
			{pending && (
				<p className="sr-only" role="status">
					Loading the projection.
				</p>
			)}
			<div
				className="grid grid-cols-[minmax(0,1fr)_18.75rem] items-start gap-6 [@media(1050px<width<=1250px)]:grid-cols-[minmax(0,1fr)_16.25rem] [@media(max-width:1250px)]:gap-4 [@media(max-width:1050px)]:grid-cols-1 print:grid-cols-1!"
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
				<div className="sticky top-5 flex min-w-0 flex-col gap-4 [@media(max-width:1050px)]:static">
					<OutlookMetrics
						plan={plan}
						projection={base}
						years={years}
						onEvidence={onEvidence}
						pending={pending}
					/>
				</div>
			</div>
			{pinnedError && (
				<ErrorNotice
					message={pinnedError}
					action="Reload pins"
					onAction={() => {
						void refreshPins();
					}}
				/>
			)}
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
				onEvaluation={onEvaluation}
			/>
			<div className="mt-6 [@media(max-width:600px)]:mt-5" aria-busy={pending}>
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
