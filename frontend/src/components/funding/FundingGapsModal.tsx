import { AlertCircle, CalendarDays, TriangleAlert } from "lucide-react";
import { SegmentedBar } from "../SegmentedBar.tsx";
import { Badge, Modal } from "../ui.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import {
	orderedFundingGaps,
	summarizeFundingGap,
	type FundingGap,
} from "../../domain/fundingGaps.ts";
import { fundingLabels } from "../../domain/fundingTerminology.ts";
import { BalancePathChart } from "./BalancePathChart.tsx";
import { FundingMovementIcon } from "./FundingMovementIcon.tsx";

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
			title={fundingLabels.detail}
			eyebrow={`Gap ${index + 1} of ${sorted.length} · ${dateLabel(gap.date, true)}`}
			wide
			onClose={onClose}
		>
			<div
				className="mt-1 mb-4 inline-flex gap-0.5 rounded-control border border-line bg-surface-2 p-1"
				role="group"
				aria-label="Choose projected funding gap"
			>
				{sorted.map((item) => (
					<button
						className="rounded-control border-0 bg-transparent px-2 py-1 text-xs whitespace-nowrap text-muted aria-pressed:bg-surface aria-pressed:font-bold aria-pressed:text-ink aria-pressed:shadow-xs"
						key={item.id}
						type="button"
						aria-pressed={item.id === gap.id}
						onClick={() => onSelect(item.id)}
					>
						{dateLabel(item.date)}
					</button>
				))}
			</div>
			<div className="flex items-center justify-between gap-4">
				<div>
					<h2 className="text-xl">{gap.name}</h2>
					<p className="mt-1 py-1 text-xs leading-relaxed text-muted">
						{gap.fundingAccount.name} · Not executed — the payment has not
						posted. The red vector shows what would happen if forced.
					</p>
				</div>
				<Badge tone="warning">Unfunded</Badge>
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
			<p className="py-2 text-sm leading-relaxed text-muted">
				<AlertCircle
					size={13}
					aria-hidden="true"
					className="inline align-middle"
				/>{" "}
				{money(summary.shortfall)} short · Available {money(summary.available)}{" "}
				· Required {money(gap.requiredAmount)}
			</p>
			<BalancePathChart gap={gap} />
			<div className="my-3.5 grid grid-cols-3 gap-2.5">
				<div className="rounded-control bg-surface-2 px-3 py-2.5">
					<span className="text-xs text-muted">Opening</span>
					<strong className="mt-1 block text-sm tabular-nums">
						{money(gap.openingBalance)}
					</strong>
				</div>
				<div className="rounded-control bg-surface-2 px-3 py-2.5">
					<span className="text-xs text-muted">Money in</span>
					<strong className="mt-1 block text-sm tabular-nums">
						+{money(summary.moneyIn)}
					</strong>
				</div>
				<div className="rounded-control bg-surface-2 px-3 py-2.5">
					<span className="text-xs text-muted">Money out</span>
					<strong className="mt-1 block text-sm tabular-nums">
						−{money(summary.moneyOut)}
					</strong>
				</div>
			</div>
			<h3 className="mt-3.5 mb-1 text-sm">Before the payment</h3>
			<p className="text-sm leading-relaxed text-muted">
				Opening balance {money(gap.openingBalance)} on{" "}
				{dateLabel(gap.windowStartDate, true)} · {summary.rows.length} movements
				in execution order · Later deposits excluded
			</p>
			{/* oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes semantics from unstyled grid lists. */}
			<ul className="mt-3 mb-0 grid list-none p-0" role="list">
				{summary.rows.map((row) => (
					<li
						key={row.id}
						className="flex items-center gap-3 border-t border-line py-2.5 text-xs"
					>
						<FundingMovementIcon kind={row.kind} />
						<div className="min-w-0 flex-1">
							<div>{row.name}</div>
							<small className="text-xs text-muted">
								{dateLabel(row.date, true)}
								{row.counterpartAccountName
									? ` · ${row.counterpartAccountName}`
									: ""}
							</small>
						</div>
						<div className="min-w-0 flex-1 text-right tabular-nums">
							<div>
								{row.amount >= 0 ? "+" : "−"}
								{money(Math.abs(row.amount))}
							</div>
							<small className="text-xs text-muted">
								→ {money(row.balanceAfter)}
							</small>
						</div>
					</li>
				))}
			</ul>
			{/* oxlint-enable jsx-a11y/no-redundant-roles */}
			<div className="mt-3 flex items-center justify-between gap-3 rounded-surface border border-danger-border bg-danger-bg p-3">
				<span className="flex items-center gap-2.5">
					<TriangleAlert size={18} aria-hidden="true" />
					<span>
						<strong className="text-xs">{gap.name}</strong>
						<br />
						<small className="text-muted">
							{dateLabel(gap.date, true)} · Not executed
						</small>
					</span>
				</span>
				<span className="text-right tabular-nums">
					<strong>−{money(gap.requiredAmount)}</strong>
					<br />
					<small>{money(summary.shortfall)} gap</small>
				</span>
			</div>
			<p className="pt-3 text-sm leading-relaxed text-muted">
				<CalendarDays
					size={13}
					aria-hidden="true"
					className="inline align-middle"
				/>{" "}
				Projected schedule · Local {gap.fundingAccount.name} cash flow only —
				transfers are not household income or expenses.
			</p>
		</Modal>
	);
}

export type { FundingGap };
