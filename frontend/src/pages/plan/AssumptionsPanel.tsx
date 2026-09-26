import { SlidersHorizontal } from "lucide-react";
import type { Plan } from "../../domain/model.ts";

export function AssumptionsPanel({
	assumptions,
	onEdit,
}: {
	assumptions: Plan["assumptions"];
	onEdit: () => void;
}) {
	return (
		<div className="assumptions-page">
			<div className="section-top">
				<div>
					<h2>The inputs behind the outlook</h2>
					<p>Visible assumptions. Deliberate changes.</p>
				</div>
				<button type="button" className="button secondary" onClick={onEdit}>
					<SlidersHorizontal size={16} />
					Edit assumptions
				</button>
			</div>
			<div className="assumption-metrics">
				<div>
					<span>Annual inflation</span>
					<strong>{assumptions.inflation}%</strong>
					<p>For the “today’s dollars” view.</p>
				</div>
				<div>
					<span>Investment variability</span>
					<strong>{assumptions.volatility}%</strong>
					<p>Yearly standard deviation in percentage points.</p>
				</div>
				<div>
					<span>Modeled scenarios</span>
					<strong>400</strong>
					<p>A repeatable set of possible return paths.</p>
				</div>
			</div>
			<div className="method-note">
				<h3>How the projection works</h3>
				<p>
					Balances accrue growth between dated movements. Recurring movements
					run on their scheduled day, clamped to month end when necessary.
					Source accounts retain their protected balance; incoming movements
					respect account ceilings. Debt payments stop when the debt reaches
					zero.
				</p>
				<p>
					Rates and movement increases are nominal. Taxes, investment fees,
					withdrawal eligibility and lending rules need explicit movements or
					constraints. Historical records are evidence; they are already
					reflected in starting balances.
				</p>
				<p>
					The range varies investment returns only. It does not model job loss,
					unplanned spending, or every source of financial risk.
				</p>
			</div>
		</div>
	);
}
