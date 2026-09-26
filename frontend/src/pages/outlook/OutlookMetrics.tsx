import {
	ArrowRight,
	ArrowUpRight,
	CircleHelp,
	Leaf,
	TrendingUp,
} from "lucide-react";
import { IconButton } from "../../components/ui.tsx";
import { compactMoney, dateLabel, money } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import {
	currentNetWorth,
	type Projection,
	type RangeResult,
} from "../../domain/projection.ts";

export function OutlookMetrics({
	plan,
	projection,
	range,
	ranges,
	years,
	rangeError,
	onEvidence,
	onAssumptions,
	onEnableRange,
}: {
	plan: Plan;
	projection: Projection;
	range: RangeResult | null;
	ranges: boolean;
	years: number;
	rangeError: string | null;
	onEvidence: () => void;
	onAssumptions: () => void;
	onEnableRange: () => void;
}) {
	const current = currentNetWorth({ projection, plan });
	const final = projection.points.at(-1);
	const band = range?.points.at(-1);
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
					<span className="subtle-divider" />
					USD
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
				<div className="metric-context">
					{years}-year projection · future dollars
				</div>
			</section>
			<section className="metric metric-range">
				<div className="metric-heading">
					<span>
						{ranges ? "The range of possibility" : "Make room for uncertainty"}
					</span>
					<Leaf size={18} />
				</div>
				{ranges ? (
					<>
						<div className="range-value">
							{band
								? `${compactMoney(band.lower)} – ${compactMoney(band.upper)}`
								: rangeError
									? "Range unavailable"
									: "Calculating…"}
						</div>
						<p>
							{band
								? `80% of ${range?.count} scenarios · median ${compactMoney(band.median)}`
								: rangeError
									? "Saved data and the base case are unchanged"
									: "Varying annual investment returns"}
						</p>
						<button
							type="button"
							className="text-button"
							onClick={onAssumptions}
						>
							Explore the assumptions <ArrowUpRight size={15} />
						</button>
					</>
				) : (
					<>
						<p>
							See how different investment returns could change the destination.
						</p>
						<button
							type="button"
							className="text-button"
							onClick={onEnableRange}
						>
							Explore a range <ArrowRight size={15} />
						</button>
					</>
				)}
			</section>
		</div>
	);
}
