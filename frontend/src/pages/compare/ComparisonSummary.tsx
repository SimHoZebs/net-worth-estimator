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
	current: ComparisonMetrics | null;
	previous: ComparisonMetrics | null;
	comparable: boolean;
	snapshot: Pick<Snapshot, "capturedAt" | "years"> | null;
	revision: number;
	years: number;
	changeCount: number;
	onCapture: () => void;
}) {
	// Panel headings are plan data and stay live; only metric cells await
	// projections. Capture needs current metrics, so it waits too.
	const pending = current === null || previous === null;
	const prev = pending ? null : previous;
	const curr = pending ? null : current;
	const delta = curr !== null && prev !== null ? curr.final - prev.final : 0;
	return (
		<>
			<section className="comparison-hero">
				<span className="comparison-icon">
					<GitCompareArrows size={26} />
				</span>
				<div>
					<p>Capture a point of reference, then explore a change.</p>
				</div>
				<button
					type="button"
					className="button secondary"
					onClick={onCapture}
					disabled={pending}
				>
					<Camera size={16} />
					{snapshot ? "Replace snapshot" : "Capture snapshot"}
				</button>
			</section>
			{!comparable && !pending && (
				<div className="inline-notice amber">
					<TriangleAlert size={20} />
					<span>
						Source balances, rates, inflation, plan name, or horizon changed.
						These values are not a like-for-like comparison.
					</span>
				</div>
			)}
			{pending && (
				<p className="sr-only" role="status">
					Loading comparison measures.
				</p>
			)}
			<section className="panel comparison-panel" aria-busy={pending}>
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
							{changeCount ? "Changes" : "Current saved plan"}
						</Badge>
						<span>
							{years}-year horizon · {changeCount} unsaved
						</span>
					</div>
				</div>
				<div className="comparison-grid">
					<span>Current net worth</span>
					{prev === null ? (
						<span
							className="skeleton"
							style={{ width: 90, height: 16 }}
							aria-hidden="true"
						/>
					) : (
						<strong>{money(prev.current)}</strong>
					)}
					{curr === null ? (
						<span
							className="skeleton"
							style={{ width: 90, height: 16 }}
							aria-hidden="true"
						/>
					) : (
						<strong>{money(curr.current)}</strong>
					)}
				</div>
				<div className="comparison-grid emphasis">
					<span>
						Projected net worth<small>Base case</small>
					</span>
					{prev === null ? (
						<span
							className="skeleton"
							style={{ width: 90, height: 16 }}
							aria-hidden="true"
						/>
					) : (
						<strong>{money(prev.final)}</strong>
					)}
					{curr === null ? (
						<span
							className="skeleton"
							style={{ width: 90, height: 16 }}
							aria-hidden="true"
						/>
					) : (
						<div>
							<strong>{money(curr.final)}</strong>
							<span
								className={`comparison-delta ${delta >= 0 ? "positive" : "negative"}`}
							>
								{delta > 0 ? "+" : ""}
								{money(delta)} difference
							</span>
						</div>
					)}
				</div>
				<div className="comparison-grid">
					<span>First net-worth evaluation reached</span>
					{prev === null ? (
						<span
							className="skeleton"
							style={{ width: 90, height: 16 }}
							aria-hidden="true"
						/>
					) : (
						<strong>
							{prev.evaluationDate
								? dateLabel(prev.evaluationDate)
								: "Not reached"}
						</strong>
					)}
					{curr === null ? (
						<span
							className="skeleton"
							style={{ width: 90, height: 16 }}
							aria-hidden="true"
						/>
					) : (
						<strong>
							{curr.evaluationDate
								? dateLabel(curr.evaluationDate)
								: "Not reached"}
						</strong>
					)}
				</div>
				<div className="comparison-grid">
					<span>First underfunded transaction</span>
					{prev === null ? (
						<span
							className="skeleton"
							style={{ width: 90, height: 16 }}
							aria-hidden="true"
						/>
					) : (
						<strong>
							{prev.shortfallDate
								? dateLabel(prev.shortfallDate, true)
								: "None in horizon"}
						</strong>
					)}
					{curr === null ? (
						<span
							className="skeleton"
							style={{ width: 90, height: 16 }}
							aria-hidden="true"
						/>
					) : (
						<strong>
							{curr.shortfallDate
								? dateLabel(curr.shortfallDate, true)
								: "None in horizon"}
						</strong>
					)}
				</div>
			</section>
		</>
	);
}
