import { RotateCcw, Save } from "lucide-react";
import { Badge } from "../../components/ui.tsx";
import { changeDetails, type PlanChange } from "../../domain/comparison.ts";

export function ChangesPanel({
	changes,
	serverMode,
	readOnly,
	saving,
	onSave,
	onDiscard,
}: {
	changes: PlanChange[];
	serverMode: boolean;
	readOnly: boolean;
	saving: boolean;
	onSave: () => void;
	onDiscard: () => void;
}) {
	return (
		<section className="panel changes-panel">
			<div className="section-top">
				<div>
					<h2>Your changes</h2>
					<p>
						{changes.length
							? `Review what will be saved ${serverMode ? "on the server" : "in this browser"}.`
							: "No unsaved changes."}
					</p>
				</div>
				{changes.length > 0 && (
					<Badge tone="amber">
						{changes.length} {changes.length === 1 ? "change" : "changes"}
					</Badge>
				)}
			</div>
			<div className="change-list">
				{changes.map((change) => (
					<details
						key={`${change.label}-${change.kind}`}
						className="change-item"
					>
						<summary>
							<Badge tone={change.kind === "Removed" ? "amber" : "neutral"}>
								{change.kind}
							</Badge>
							<strong>{change.label}</strong>
							<span>Review details</span>
						</summary>
						<ChangeDetails before={change.before} after={change.after} />
					</details>
				))}
			</div>
			{changes.length > 0 && (
				<div className="review-actions">
					<button
						type="button"
						className="button secondary"
						onClick={onDiscard}
						disabled={saving}
					>
						<RotateCcw size={16} />
						Discard changes
					</button>
					<button
						type="button"
						className="button primary"
						onClick={onSave}
						disabled={readOnly || saving}
						aria-busy={saving}
					>
						<Save size={16} />
						{saving ? "Saving…" : "Save this plan"}
					</button>
				</div>
			)}
			{readOnly && (
				<p className="section-note">
					{serverMode
						? "The server is read-only. Export the temporary version from Data & sources to keep a separate copy."
						: "The source is read-only. Export the temporary version from Data & sources to keep a separate copy."}
				</p>
			)}
		</section>
	);
}

function ChangeDetails({
	before,
	after,
}: Pick<PlanChange, "before" | "after">) {
	const details = changeDetails({ before, after });
	if (details.kind === "text")
		return (
			<p>
				{details.before} → {details.after}
			</p>
		);
	return (
		<dl className="change-details">
			{details.rows.map((row) => (
				<div key={row.key}>
					<dt>{row.label}</dt>
					<dd>
						<span>{row.before}</span>
						<span aria-hidden="true">→</span>
						<strong>{row.after}</strong>
					</dd>
				</div>
			))}
		</dl>
	);
}
