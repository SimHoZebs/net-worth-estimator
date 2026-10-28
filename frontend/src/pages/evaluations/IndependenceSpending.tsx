import { inspectionValueStyles } from "@/components/inspectionStyles.ts";
import { SegmentedBar } from "@/components/SegmentedBar.tsx";
import {
	independenceFunding,
	type IndependenceCandidate,
} from "@/domain/financialIndependence.ts";
import { dateLabel, exactMoney, money } from "@/domain/format.ts";

const amount = (value: number) =>
	value > 0 && value < 1 ? exactMoney(value) : money(value);

export function IndependenceSpending({
	candidate,
}: {
	candidate: IndependenceCandidate;
}) {
	const funding = independenceFunding(candidate);
	if (!funding || funding.income < 0 || funding.withdrawals < 0)
		return (
			<p className="m-0 text-xs text-muted">
				Spending evidence is unavailable for this start date.
			</p>
		);
	const { spending, gap, surplus } = funding;
	// The bar represents the spending target, not the larger pool of available
	// funding. Income covers spending first; only the remaining need uses assets.
	const income = Math.min(spending, funding.income);
	const withdrawals = Math.min(
		Math.max(0, spending - income),
		funding.withdrawals,
	);
	return (
		<div className="grid gap-4">
			<dl className="m-0 grid grid-cols-2 gap-3">
				<div>
					<dt className="text-xs text-muted">Annual spending</dt>
					<dd
						className={inspectionValueStyles({
							size: "hero",
							className: "mt-1 text-2xl max-sm:text-xl",
						})}
					>
						{amount(spending)}
						<span className="text-sm font-normal text-muted">/yr</span>
					</dd>
				</div>
				<div>
					<dt className="text-xs text-muted">Unfunded</dt>
					<dd
						className={inspectionValueStyles({
							size: "hero",
							tone: gap > 0 ? "negative" : "positive",
							className: "mt-1 text-2xl max-sm:text-xl",
						})}
					>
						{amount(gap)}
						<span className="text-sm font-normal">/yr</span>
					</dd>
				</div>
			</dl>
			<SegmentedBar
				caption="Annual spending"
				showAmounts={false}
				ariaLabel={`Annual spending at ${dateLabel(candidate.date)}: ${amount(spending)}. Income funds ${amount(income)}, withdrawals fund ${amount(withdrawals)}, ${amount(gap)} is unfunded.`}
				captionClassName="sr-only"
				segments={[
					{ label: "Income", amount: income, tone: "sage", pattern: "solid" },
					{
						label: "Withdrawals",
						amount: withdrawals,
						tone: "blue",
						pattern: "dots",
					},
					{ label: "Unfunded", amount: gap, tone: "tan", pattern: "hatch" },
				]}
			/>
			{surplus > 0 && (
				<p className="m-0 text-xs text-muted">
					{amount(surplus)}/yr extra funding capacity.
				</p>
			)}
		</div>
	);
}
