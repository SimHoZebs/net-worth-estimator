import { Camera, GitCompareArrows, TriangleAlert } from "lucide-react";
import { Badge } from "../../components/ui.tsx";
import type { ComparisonMetrics } from "../../domain/comparison.ts";
import { dateLabel, money } from "../../domain/format.ts";
import type { Snapshot } from "../../state/storage.ts";

export function ComparisonSummary({
	current,
	previous,
	comparable,
	snapshot,
	revision,
	years,
	changeCount,
	onCapture,
}: {
	current: ComparisonMetrics;
	previous: ComparisonMetrics;
	comparable: boolean;
	snapshot: Pick<Snapshot, "capturedAt" | "years"> | null;
	revision: number;
	years: number;
	changeCount: number;
	onCapture: () => void;
}) {
	const delta = current.final - previous.final;
	return (
		<>
			<section className="comparison-hero">
				<span className="comparison-icon">
					<GitCompareArrows size={26} />
				</span>
				<div>
					<h2>A clearer view of what changed.</h2>
					<p>
						{changeCount
							? `${changeCount} unsaved ${changeCount === 1 ? "change" : "changes"} · your saved plan is unchanged`
							: "Capture a point of reference, then explore a change."}
					</p>
				</div>
				<button type="button" className="button secondary" onClick={onCapture}>
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
								: `Revision ${revision}`}{" "}
							· {snapshot?.years ?? years} years
						</span>
					</div>
					<div>
						<Badge tone={changeCount ? "amber" : "green"}>
							{changeCount ? "Temporary version" : "Current saved plan"}
						</Badge>
						<span>
							{years}-year horizon · {changeCount} unsaved
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
		</>
	);
}
