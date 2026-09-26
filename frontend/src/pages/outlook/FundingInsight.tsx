import { ArrowUpRight, ShieldCheck, TriangleAlert } from "lucide-react";
import { Progress } from "../../components/ui.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import type { MovementResult } from "../../domain/projection.ts";

export function FundingInsight({
	failure,
	onFailure,
	onPlan,
}: {
	failure: MovementResult | null;
	onFailure: () => void;
	onPlan: () => void;
}) {
	return (
		<aside className={`insight-card ${failure ? "" : "insight-positive"}`}>
			<div className="eyebrow">
				<span className="insight-symbol">
					{failure ? <TriangleAlert size={16} /> : <ShieldCheck size={16} />}
				</span>
				{failure ? "Worth a closer look" : "Room to move forward"}
			</div>
			<h2>
				{failure
					? "A future expense needs more room."
					: "Your planned movements are covered."}
			</h2>
			{failure ? (
				<>
					<p>
						<strong>{failure.name}</strong> is only partly funded in{" "}
						{dateLabel(failure.date)}.
					</p>
					<div className="funding-values">
						<div>
							<span>Available</span>
							<strong>{money(failure.realized)}</strong>
						</div>
						<div>
							<span>Planned</span>
							<strong>{money(failure.requested)}</strong>
						</div>
					</div>
					<Progress
						value={(failure.realized / failure.requested) * 100}
						label="Funded portion of first shortfall"
						tone="amber"
					/>
					<div className="shortfall-line">
						<TriangleAlert size={14} />
						<span>{money(failure.requested - failure.realized)} shortfall</span>
					</div>
					<button
						type="button"
						className="button insight-button"
						onClick={onFailure}
					>
						Inspect this expense <ArrowUpRight size={16} />
					</button>
					<span className="insight-caption">
						First shortfall in the base case
					</span>
				</>
			) : (
				<>
					<p>
						No underfunded movements appear within the selected horizon.
						Investment returns remain uncertain.
					</p>
					<button
						type="button"
						className="button insight-button"
						onClick={onPlan}
					>
						Review planned movements <ArrowUpRight size={16} />
					</button>
					<span className="insight-caption">Based on current assumptions</span>
				</>
			)}
		</aside>
	);
}
