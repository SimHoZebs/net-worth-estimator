import {
	Camera,
	GitCompareArrows,
	RotateCcw,
	Save,
	TriangleAlert,
} from "lucide-react";
import { useState } from "react";
import { Badge } from "../components/ui.tsx";
import { dateLabel, money } from "../domain/format.ts";
import type { Plan } from "../domain/model.ts";
import { changesBetween } from "../domain/model.ts";
import { currentNetWorth, type Projection } from "../domain/projection.ts";
import type { Snapshot } from "../state/storage.ts";

const metricRows = (projection: Projection, plan: Plan) => ({
	current: currentNetWorth({ projection, plan }),
	final: projection.points.at(-1)?.total ?? 0,
	goalDate:
		projection.goals.find((g) => g.goal.kind === "net-worth")?.firstDate ??
		null,
	shortfallDate: projection.firstFailure?.date ?? null,
});
const assumptionKey = (plan: Plan) =>
	JSON.stringify({
		...plan.assumptions,
		rates: plan.accounts.map((a) => ({
			id: a.id,
			rate: a.annualReturn,
			balance: a.balance,
			observedOn: a.observedOn,
			source: a.source,
		})),
	});

export function ComparePage({
	saved,
	plan,
	projection,
	savedProjection,
	snapshot,
	years,
	serverMode = false,
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
	serverMode?: boolean;
	readOnly?: boolean;
	onCapture: (snapshot: Snapshot) => void;
	onSave: () => undefined | Promise<boolean>;
	onDiscard: () => void;
}) {
	const [saving, setSaving] = useState(false);
	const changes = changesBetween({ saved, current: plan });
	const current = metricRows(projection, plan);
	const previous = snapshot ?? metricRows(savedProjection, saved);
	const comparable =
		!snapshot ||
		(snapshot.years === years &&
			snapshot.startDate === plan.startDate &&
			snapshot.assumptions === assumptionKey(plan) &&
			snapshot.name === plan.name);
	const delta = current.final - previous.final;
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
			<section className="comparison-hero">
				<span className="comparison-icon">
					<GitCompareArrows size={26} />
				</span>
				<div>
					<h2>A clearer view of what changed.</h2>
					<p>
						{changes.length
							? `${changes.length} unsaved ${changes.length === 1 ? "change" : "changes"} · your saved plan is unchanged`
							: "Capture a point of reference, then explore a change."}
					</p>
				</div>
				<button
					type="button"
					className="button secondary"
					onClick={() =>
						onCapture({
							capturedAt: new Date().toISOString(),
							name: plan.name,
							years,
							startDate: plan.startDate,
							revision: saved.revision,
							changes: changes.length,
							assumptions: assumptionKey(plan),
							...current,
						})
					}
				>
					<Camera size={16} />
					{snapshot ? "Replace snapshot" : "Capture snapshot"}
				</button>
			</section>
			{!comparable && (
				<div className="inline-notice amber">
					<TriangleAlert size={20} />
					<span>
						<strong>The contexts differ.</strong> Source balances, rates,
						inflation, plan name, or horizon changed. These values are not a
						like-for-like comparison.
					</span>
				</div>
			)}
			<section className="panel comparison-panel">
				<div className="comparison-grid comparison-head">
					<span>Measure</span>
					<div>
						<Badge tone="outline">
							{snapshot ? "Captured snapshot" : "Saved plan"}
						</Badge>
						<span>
							{snapshot
								? dateLabel(snapshot.capturedAt, true)
								: `Revision ${saved.revision}`}{" "}
							· {snapshot?.years ?? years} years
						</span>
					</div>
					<div>
						<Badge tone={changes.length ? "amber" : "green"}>
							{changes.length ? "Temporary version" : "Current saved plan"}
						</Badge>
						<span>
							{years}-year horizon · {changes.length} unsaved
						</span>
					</div>
				</div>
				<div className="comparison-grid">
					<span>Current net worth</span>
					<strong>{money(previous.current)}</strong>
					<strong>{money(current.current)}</strong>
				</div>
				<div className="comparison-grid emphasis">
					<span>
						Projected net worth<small>Future dollars · base case</small>
					</span>
					<strong>{money(previous.final)}</strong>
					<div>
						<strong>{money(current.final)}</strong>
						<span
							className={`comparison-delta ${delta >= 0 ? "positive" : "negative"}`}
						>
							{delta > 0 ? "+" : ""}
							{money(delta)} difference
						</span>
					</div>
				</div>
				<div className="comparison-grid">
					<span>First net-worth goal reached</span>
					<strong>
						{previous.goalDate ? dateLabel(previous.goalDate) : "Not reached"}
					</strong>
					<strong>
						{current.goalDate ? dateLabel(current.goalDate) : "Not reached"}
					</strong>
				</div>
				<div className="comparison-grid">
					<span>First underfunded movement</span>
					<strong>
						{previous.shortfallDate
							? dateLabel(previous.shortfallDate, true)
							: "None in horizon"}
					</strong>
					<strong>
						{current.shortfallDate
							? dateLabel(current.shortfallDate, true)
							: "None in horizon"}
					</strong>
				</div>
				<p className="section-note">
					Comparison describes displayed measures, not causal proof. A snapshot
					contains measures only and cannot restore a plan. Goal definitions may
					also change between versions.
				</p>
			</section>
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
							onClick={() => {
								void save();
							}}
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
		</>
	);
}

const fieldNames: Record<string, string> = {
	name: "Name",
	amount: "Amount",
	balance: "Balance",
	floor: "Protected balance",
	ceiling: "Maximum balance",
	annualReturn: "Annual rate (%)",
	annualIncrease: "Annual increase (%)",
	startDate: "Start date",
	endDate: "End date",
	frequency: "Frequency",
	target: "Target",
	enabled: "Included",
	fromId: "Source account",
	toId: "Destination account",
	accountId: "Account",
	observedOn: "Balance date",
	provenance: "Basis",
	source: "Source",
	volatility: "Investment variability (%)",
	inflation: "Inflation (%)",
	kind: "Type",
};
function ChangeDetails({ before, after }: { before: string; after: string }) {
	if ((before && !before.startsWith("{")) || (after && !after.startsWith("{")))
		return (
			<p>
				{before || "New"} → {after || "Removed"}
			</p>
		);
	const a = before
		? (JSON.parse(before) as Record<string, string | number | boolean | null>)
		: {};
	const b = after
		? (JSON.parse(after) as Record<string, string | number | boolean | null>)
		: {};
	const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
		(key) => key !== "id" && key !== "readOnly" && a[key] !== b[key],
	);
	const display = (
		value: string | number | boolean | null | undefined,
		key: string,
	) =>
		value === null || value === undefined
			? "None"
			: typeof value === "boolean"
				? value
					? "Yes"
					: "No"
				: typeof value === "number" &&
						["amount", "balance", "floor", "ceiling", "target"].includes(key)
					? money(value)
					: String(value);
	return (
		<dl className="change-details">
			{keys.map((key) => (
				<div key={key}>
					<dt>{fieldNames[key] ?? key}</dt>
					<dd>
						<span>{display(a[key], key)}</span>
						<span aria-hidden="true">→</span>
						<strong>{display(b[key], key)}</strong>
					</dd>
				</div>
			))}
		</dl>
	);
}
