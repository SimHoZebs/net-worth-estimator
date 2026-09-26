import { ArrowUpRight, CalendarDays, Check } from "lucide-react";
import { Badge, IconButton } from "../../components/ui.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import type { Plan } from "../../domain/model.ts";
import type { Projection } from "../../domain/projection.ts";
import { cashTiming } from "../../domain/timing.ts";

export function TimingPreview({
	plan,
	projection,
	onTiming,
}: {
	plan: Plan;
	projection: Projection;
	onTiming: () => void;
}) {
	const { cash, commitments, nextPay } = cashTiming({ plan, projection });
	return (
		<section className="timing-preview">
			<div className="section-top">
				<h2>
					<CalendarDays size={18} />
					The next 30 days
				</h2>
				<Badge tone="outline">Cash timing</Badge>
			</div>
			<div className="timing-figures">
				<div>
					<span>Cash above protected balances</span>
					<strong>{money(cash)}</strong>
				</div>
				<div>
					<span>Planned commitments</span>
					<strong>{money(commitments)}</strong>
				</div>
			</div>
			<div className="timing-replenishment">
				<span className="timing-check">
					<Check size={16} />
				</span>
				<span>
					{nextPay ? (
						<>
							<strong>{money(nextPay.requested)} coming in</strong>
							<span>{dateLabel(nextPay.date, true)} · planned income</span>
						</>
					) : (
						<>
							<strong>No incoming cash scheduled</strong>
							<span>Review your near-term plan</span>
						</>
					)}
				</span>
				<IconButton
					icon={ArrowUpRight}
					label="Inspect next 30 days"
					onClick={onTiming}
				/>
			</div>
		</section>
	);
}
