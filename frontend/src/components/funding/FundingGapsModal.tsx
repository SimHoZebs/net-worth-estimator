import { AlertCircle, CalendarDays, TriangleAlert } from "lucide-react";
import { SegmentedBar } from "../SegmentedBar.tsx";
import { Badge, Modal } from "../ui.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import {
	orderedFundingGaps,
	summarizeFundingGap,
	type FundingGap,
} from "../../domain/fundingGaps.ts";
import { BalancePathChart } from "./BalancePathChart.tsx";
import { FundingMovementIcon } from "./FundingGapsCard.tsx";
import "./funding-gaps.css";

export function FundingGapsModal({
	gaps,
	selectedId,
	onSelect,
	onClose,
}: {
	gaps: FundingGap[];
	selectedId: string;
	onSelect: (id: string) => void;
	onClose: () => void;
}) {
	const sorted = orderedFundingGaps(gaps);
	const gap = sorted.find((item) => item.id === selectedId) ?? sorted[0];
	if (!gap) return null;
	const summary = summarizeFundingGap(gap);
	const index = sorted.findIndex((item) => item.id === gap.id);
	return (
		<Modal
			title="Funding failure"
			eyebrow={`Failure ${index + 1} of ${sorted.length} · ${dateLabel(gap.date, true)}`}
			wide
			onClose={onClose}
		>
			<div
				className="segmented funding-date-tabs"
				role="group"
				aria-label="Choose projected failure"
			>
				{sorted.map((item) => (
					<button
						key={item.id}
						type="button"
						aria-pressed={item.id === gap.id}
						onClick={() => onSelect(item.id)}
					>
						{dateLabel(item.date)}
					</button>
				))}
			</div>
			<div className="section-top">
				<div>
					<h2 className="funding-gap-heading">{gap.name}</h2>
					<p className="section-note funding-gap-summary">
						{gap.fundingAccount.name} · Not executed — the payment has not
						posted. The red vector shows what would happen if forced.
					</p>
				</div>
				<Badge tone="amber">Unfunded</Badge>
			</div>
			<SegmentedBar
				caption={`Available ${money(summary.available)} of ${money(gap.requiredAmount)} required`}
				ariaLabel={`Payment coverage: ${Math.round(summary.coveragePercent)} percent covered, ${money(summary.shortfall)} short`}
				segments={[
					{
						label: "Covered",
						amount: summary.coveredAmount,
						pattern: "solid",
						tone: "sage",
					},
					{
						label: "Missing",
						amount: summary.shortfall,
						pattern: "hatch",
						tone: "tan",
					},
				]}
			/>
			<p className="section-note">
				<AlertCircle size={13} aria-hidden="true" className="inline-icon" />{" "}
				{money(summary.shortfall)} short · Available {money(summary.available)}{" "}
				· Required {money(gap.requiredAmount)}
			</p>
			<BalancePathChart gap={gap} />
			<div className="funding-metrics">
				<div>
					<span>Opening</span>
					<strong>{money(gap.openingBalance)}</strong>
				</div>
				<div>
					<span>Money in</span>
					<strong>+{money(summary.moneyIn)}</strong>
				</div>
				<div>
					<span>Money out</span>
					<strong>−{money(summary.moneyOut)}</strong>
				</div>
			</div>
			<h3 className="funding-ledger-heading">Before the payment</h3>
			<p className="section-note section-note-flush">
				Opening balance {money(gap.openingBalance)} on{" "}
				{dateLabel(gap.windowStartDate, true)} · {summary.rows.length} movements
				in execution order · Later deposits excluded
			</p>
			<ul className="funding-ledger">
				{summary.rows.map((row) => (
					<li key={row.id}>
						<FundingMovementIcon kind={row.kind} />
						<div>
							<div>{row.name}</div>
							<small>
								{dateLabel(row.date, true)}
								{row.counterpartAccountName
									? ` · ${row.counterpartAccountName}`
									: ""}
							</small>
						</div>
						<div className="numeric">
							<div>
								{row.amount >= 0 ? "+" : "−"}
								{money(Math.abs(row.amount))}
							</div>
							<small>→ {money(row.balanceAfter)}</small>
						</div>
					</li>
				))}
			</ul>
			<div className="funding-failed-row">
				<span className="funding-failed-summary">
					<TriangleAlert size={18} aria-hidden="true" />
					<span>
						<strong className="funding-failed-name">{gap.name}</strong>
						<br />
						<small className="muted">
							{dateLabel(gap.date, true)} · Not executed
						</small>
					</span>
				</span>
				<span className="numeric funding-failed-amount">
					<strong>−{money(gap.requiredAmount)}</strong>
					<br />
					<small>{money(summary.shortfall)} gap</small>
				</span>
			</div>
			<p className="section-note funding-window-note">
				<CalendarDays size={13} aria-hidden="true" className="inline-icon" />{" "}
				Projected schedule · Local {gap.fundingAccount.name} cash flow only —
				transfers are not household income or expenses.
			</p>
		</Modal>
	);
}

export type { FundingGap };
