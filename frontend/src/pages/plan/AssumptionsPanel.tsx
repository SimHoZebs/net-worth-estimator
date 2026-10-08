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
				<h2>The inputs behind the outlook</h2>
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
		</div>
	);
}
