import { ArrowUpRight, ShieldCheck, TriangleAlert } from "lucide-react";
import { Progress } from "../../components/ui.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import type { MovementResult } from "../../domain/result.ts";

export function FundingInsight({
	failure,
	onFailure,
	onPlan,
	pending = false,
}: {
	failure: MovementResult | null;
	onFailure: () => void;
	onPlan: () => void;
	pending?: boolean;
}) {
	// A null failure with settled data is genuinely good news; a null failure
	// with pending data is unknowable, so the card stays neutral instead of
	// claiming either branch.
	if (pending)
		return (
			<article className="insight-card" aria-busy="true">
				<div className="eyebrow">
					<span
						className="skeleton"
						style={{ width: 150, height: 14 }}
						aria-hidden="true"
					/>
				</div>
				<span
					className="skeleton"
					style={{ width: 110, height: 30 }}
					aria-hidden="true"
				/>
				<span
					className="skeleton"
					style={{ width: "100%", height: 44 }}
					aria-hidden="true"
				/>
			</article>
		);
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
