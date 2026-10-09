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
}: {
	plan: Plan;
	projection: Projection;
	years: number;
	onEvidence: () => void;
}) {
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
