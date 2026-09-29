import { ArrowUpRight, ShieldCheck, TriangleAlert } from "lucide-react";
import { Progress } from "../../components/ui.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import type { MovementResult } from "../../domain/result.ts";

export function FundingInsight({
	failure,
	onFailure,
	onPlan,
}: {
	failure: MovementResult | null;
	onFailure: () => void;
	onPlan: () => void;
}) {
	const action = failure ? onFailure : onPlan;
	return (
		<article className={`insight-card ${failure ? "" : "insight-positive"}`}>
			<div className="eyebrow">
				<span className="insight-symbol">
					{failure ? <TriangleAlert size={16} /> : <ShieldCheck size={16} />}
				</span>
				{failure && <span>First shortfall in the base case</span>}
			</div>
			{failure ? (
				<>
					<h2>{money(failure.requested - failure.realized)} short</h2>
					<p>
						<strong>{failure.name}</strong> in {dateLabel(failure.date)}
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
					<button
						type="button"
						className="text-button insight-stretched"
						onClick={action}
					>
						Inspect this expense <ArrowUpRight size={14} />
					</button>
				</>
			) : (
				<>
					<p>
						No underfunded transactions appear within the selected horizon.
						Investment returns remain uncertain.
					</p>
					<button
						type="button"
						className="text-button insight-stretched"
						onClick={action}
					>
						Review planned transactions <ArrowUpRight size={14} />
					</button>
				</>
			)}
		</article>
	);
}
