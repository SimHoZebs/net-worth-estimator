import { useState } from "react";
import { captureComparison, comparisonContext } from "../domain/comparison.ts";
import type { Plan } from "../domain/model.ts";
import type { Projection } from "../domain/result.ts";
import type { Snapshot } from "../state/storage.ts";
import { ChangesPanel } from "./compare/ChangesPanel.tsx";
import { ComparisonSummary } from "./compare/ComparisonSummary.tsx";

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
	projection: Projection;
	savedProjection: Projection;
	snapshot: Snapshot | null;
	years: number;
	readOnly?: boolean;
	onCapture: (snapshot: Snapshot) => void;
	onSave: () => undefined | Promise<boolean>;
	onDiscard: () => void;
}) {
	const [saving, setSaving] = useState(false);
	const { changes, current, previous, comparable } = comparisonContext({
		saved,
		plan,
		projection,
		savedProjection,
		snapshot,
		years,
	});
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
				onCapture={() =>
					onCapture(
						captureComparison({
							plan,
							revision: saved.revision,
							years,
							changes: changes.length,
							current,
							capturedAt: new Date().toISOString(),
						}),
					)
				}
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
