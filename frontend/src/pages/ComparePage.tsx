import { useMemo, useState } from "react";
import { ErrorNotice, ProjectionUpdating } from "../components/ui.tsx";
import {
	captureComparison,
	comparisonComparable,
	comparisonMetrics,
} from "../domain/comparison.ts";
import { changesBetween, type Plan } from "../domain/model.ts";
import type { Projection } from "../domain/result.ts";
import type { Snapshot } from "../state/storage.ts";
import { useUiStore } from "../state/uiStore.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { useWorkspaceStore } from "../state/workspaceStore.ts";
import { ChangesPanel } from "./compare/ChangesPanel.tsx";
import { ComparisonSummary } from "./compare/ComparisonSummary.tsx";
import "./compare/compare.css";

export function ComparePage({ onDiscard }: { onDiscard: () => void }) {
	// Everything subscribes here: plan data from the workspace store, both
	// projections from their own queries (the saved side disables itself
	// without a draft), horizon from the interface store.
	const workspace = useWorkspaceStore((state) => state.workspace);
	const plan = workspace?.draft ?? workspace?.saved ?? null;
	const snapshot = workspace?.snapshot ?? null;
	const serverDocument = useWorkspaceStore((state) => state.serverDocument);
	const hasDraft = workspace?.draft !== null && workspace?.draft !== undefined;
	const years = useUiStore((state) => state.years);
	const statusReadOnly = useWorkspaceStore(
		(state) => state.status?.readOnly ?? false,
	);
	const writeBlocked = useWorkspaceStore((state) => state.writeBlocked);
	const capture = useWorkspaceStore((state) => state.capture);
	const save = useWorkspaceStore((state) => state.save);
	const projection = useRemoteProjection();
	// The saved side disables itself without a draft: with no draft its
	// inputs would match the active query exactly, so the active fetch covers
	// it. With a draft the keys diverge and each side computes independently.
	// Server still content-addresses seeded runs, so this only removes the
	// client duplicate subscription.
	const saved = useRemoteProjection({
		document: serverDocument,
		draftDocument: null,
		ranges: false,
		enabled: hasDraft,
	});
	if (!workspace || !plan) return null;
	const readOnly = statusReadOnly || writeBlocked || plan.readOnly;
	return (
		<CompareContent
			saved={workspace.saved}
			plan={plan}
			projection={projection}
			savedProjection={saved}
			hasDraft={hasDraft}
			snapshot={snapshot}
			years={years}
			readOnly={readOnly}
			onCapture={capture}
			onSave={() => Promise.resolve(save())}
			onDiscard={onDiscard}
		/>
	);
}

function CompareContent({
	saved,
	plan,
	projection,
	savedProjection,
	hasDraft,
	snapshot,
	years,
	readOnly,
	onCapture,
	onSave,
	onDiscard,
}: {
	saved: Plan;
	plan: Plan;
	projection: ReturnType<typeof useRemoteProjection>;
	savedProjection: ReturnType<typeof useRemoteProjection>;
	hasDraft: boolean;
	snapshot: Snapshot | null;
	years: number;
	readOnly: boolean;
	onCapture: (snapshot: Snapshot) => void;
	onSave: () => undefined | Promise<boolean>;
	onDiscard: () => void;
}) {
	const [saving, setSaving] = useState(false);
	// The change list is plan data and stays live. Only the metric columns
	// await projections; each side fills in independently as it lands.
	const baseLoadError =
		projection.base instanceof Error && !projection.loading
			? projection.base
			: null;
	const base: Projection | null =
		projection.base instanceof Error ? null : projection.base;
	const savedBase =
		savedProjection.base instanceof Error || savedProjection.base === null
			? null
			: savedProjection.base;
	const changes = useMemo(
		() => changesBetween({ saved, current: plan }),
		[saved, plan],
	);
	const current = useMemo(
		() => (base ? comparisonMetrics(base) : null),
		[base],
	);
	const previous = useMemo(
		() =>
			savedBase
				? comparisonMetrics(savedBase)
				: !hasDraft
					? current
					: null,
		[savedBase, hasDraft, current],
	);
	const comparable = comparisonComparable({ snapshot, plan, years });
	const save = async () => {
		if (saving || readOnly) return;
		setSaving(true);
		try {
			await onSave();
		} finally {
			setSaving(false);
		}
	};
	return (
		<>
			{baseLoadError && (
				<ErrorNotice
					message={baseLoadError.message}
					action="Retry calculation"
					onAction={projection.retryProjection}
				/>
			)}
			{hasDraft &&
				savedProjection.base instanceof Error &&
				!savedProjection.loading && (
					<ErrorNotice
						message={savedProjection.base.message}
						action="Retry saved calculation"
						onAction={savedProjection.retryProjection}
					/>
				)}
			{projection.baseError && base && (
				<ErrorNotice
					message={projection.baseError}
					action="Retry calculation"
					onAction={projection.retryProjection}
				/>
			)}
			{projection.loading && base && <ProjectionUpdating />}
			<ComparisonSummary
				current={current}
				previous={previous}
				comparable={comparable}
				snapshot={snapshot}
				revision={saved.revision}
				years={years}
				changeCount={changes.length}
				onCapture={() => {
					// The summary disables capture while metrics are pending.
					if (!current) return;
					onCapture(
						captureComparison({
							plan,
							revision: saved.revision,
							years,
							capturedAt: new Date().toISOString(),
						}),
					);
				}}
			/>
			<ChangesPanel
				changes={changes}
				readOnly={readOnly}
				saving={saving}
				onSave={() => {
					void save();
				}}
				onDiscard={onDiscard}
			/>
		</>
	);
}
