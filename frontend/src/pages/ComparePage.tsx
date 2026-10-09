import { useState } from "react";
import {
	captureComparison,
	comparisonComparable,
	comparisonMetrics,
} from "../domain/comparison.ts";
import { changesBetween, type Plan } from "../domain/model.ts";
import type { Projection } from "../domain/result.ts";
import type { Snapshot } from "../state/storage.ts";
import { ChangesPanel } from "./compare/ChangesPanel.tsx";
import { ComparisonSummary } from "./compare/ComparisonSummary.tsx";
import "./compare/compare.css";

export function ComparePage({
	saved,
	plan,
	projection,
	savedProjection,
	snapshot,
	years,
	readOnly = saved.readOnly,
	onCapture,
	onSave,
	onDiscard,
}: {
	saved: Plan;
	plan: Plan;
	projection: Projection | null;
	savedProjection: Projection | null;
	snapshot: Snapshot | null;
	years: number;
	readOnly?: boolean;
	onCapture: (snapshot: Snapshot) => void;
	onSave: () => undefined | Promise<boolean>;
	onDiscard: () => void;
}) {
	const [saving, setSaving] = useState(false);
	// The change list is plan data and stays live. Only the metric columns
	// await projections; each side fills in independently as it lands.
	const changes = changesBetween({ saved, current: plan });
	const current = projection ? comparisonMetrics(projection) : null;
	const previous =
		snapshot ?? (savedProjection ? comparisonMetrics(savedProjection) : null);
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
							changes: changes.length,
							current,
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
