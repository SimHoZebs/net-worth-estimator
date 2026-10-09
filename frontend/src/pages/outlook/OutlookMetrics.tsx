import { CircleHelp, TrendingUp } from "lucide-react";
import { IconButton } from "../../components/ui.tsx";
import { compactMoney, dateLabel, money } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import { currentNetWorth, type Projection } from "../../domain/result.ts";

export function OutlookMetrics({
	plan,
	projection,
	years,
	onEvidence,
	pending = false,
}: {
	plan: Plan;
	projection: Projection | null;
	years: number;
	onEvidence: () => void;
	pending?: boolean;
}) {
	if (!projection) {
		// Frames, headings, and plan-derived context render regardless; only
		// computed values skeletonize. The horizon year derives from the plan
		// start plus horizon, matching the loaded heading exactly.
		if (!pending) return null;
		const finalYear = Number.parseInt(plan.startDate.slice(0, 4), 10) + years;
		return (
			<div className="metrics-grid" aria-busy="true">
				<section className="metric metric-current">
					<div className="metric-heading">
						<span>Current net worth</span>
						<IconButton
							icon={CircleHelp}
							label="Inspect current net worth evidence"
							onClick={onEvidence}
							disabled
						/>
					</div>
					<span
						className="skeleton"
						style={{ width: 120, height: 28 }}
						aria-hidden="true"
					/>
					<div className="metric-context">
						<span className="status-dot" />
						As of {dateLabel(plan.startDate, true)}
					</div>
				</section>
				<section className="metric metric-destination">
					<div className="metric-heading">
						<span>Base case in {finalYear}</span>
						<TrendingUp size={19} />
					</div>
					<span
						className="skeleton"
						style={{ width: 140, height: 28 }}
						aria-hidden="true"
					/>
					<div className="metric-context">{years}-year projection</div>
				</section>
			</div>
		);
	}
	const current = currentNetWorth(projection);
	const final = projection.points.at(-1);
	if (!final) return null;
	return (
		<div className="metrics-grid">
			<section className="metric metric-current">
				<div className="metric-heading">
					<span>Current net worth</span>
					<IconButton
						icon={CircleHelp}
						label="Inspect current net worth evidence"
						onClick={onEvidence}
					/>
				</div>
				<div className="metric-value">{money(current)}</div>
				<div className="metric-context">
					<span className="status-dot" />
					As of {dateLabel(plan.startDate, true)}
				</div>
			</section>
			<section className="metric metric-destination">
				<div className="metric-heading">
					<span>Base case in {final.date.slice(0, 4)}</span>
					<TrendingUp size={19} />
				</div>
				<div className="metric-value" title={money(final.total)}>
					{compactMoney(final.total)}
					<span className="growth-pill">
						{final.total >= current ? "+" : ""}
						{compactMoney(final.total - current)}
					</span>
				</div>
				<div className="metric-context">{years}-year projection</div>
			</section>
		</div>
	);
}
