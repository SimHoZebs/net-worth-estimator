import { AlertCircle, CalendarDays, TriangleAlert } from "lucide-react";
import { SegmentedBar } from "../SegmentedBar.tsx";
import { Badge } from "@/components/ui/badge.tsx";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import { dateLabel, money } from "../../domain/format.ts";
import {
	orderedFundingGaps,
	summarizeFundingGap,
	type FundingGap,
} from "../../domain/fundingGaps.ts";
import { fundingLabels } from "../../domain/fundingTerminology.ts";
import { BalancePathChart } from "./BalancePathChart.tsx";
import { FundingTransactionIcon } from "./FundingTransactionIcon.tsx";

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
		<Dialog
			open
			onOpenChange={(open) => {
				if (!open) onClose();
			}}
		>
			<DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
				<DialogHeader>
					<p className="mb-2 text-xs font-bold tracking-widest text-muted-foreground">
						{`Gap ${index + 1} of ${sorted.length} · ${dateLabel(gap.date, true)}`}
					</p>
					<DialogTitle>{fundingLabels.detail}</DialogTitle>
				</DialogHeader>
				<ToggleGroup
					aria-label="Choose projected funding gap"
					value={[gap.id]}
					onValueChange={(next) => {
						const nextValue = next.find((candidate) => candidate !== gap.id);
						if (nextValue !== undefined) onSelect(nextValue);
					}}
				>
					{sorted.map((item) => (
						<ToggleGroupItem
							key={item.id}
							type="button"
							value={item.id}
							aria-label={dateLabel(item.date, true)}
						>
							{dateLabel(item.date)}
						</ToggleGroupItem>
					))}
				</ToggleGroup>
				<div className="flex items-center justify-between gap-4">
					<div>
						<h2 className="text-xl">{gap.name}</h2>
						<p className="mt-1 py-1 text-xs leading-relaxed text-muted-foreground">
							{gap.fundingAccount.name} · Not executed — the payment has not
							posted. The red vector shows what would happen if forced.
						</p>
					</div>
					<Badge variant="default" className="bg-warning-bg text-warning-text">
						Unfunded
					</Badge>
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
				<p className="py-2 text-sm leading-relaxed text-muted-foreground">
					<AlertCircle
						size={13}
						aria-hidden="true"
						className="inline align-middle"
					/>{" "}
					{money(summary.shortfall)} short · Available{" "}
					{money(summary.available)} · Required {money(gap.requiredAmount)}
				</p>
				<BalancePathChart gap={gap} />
				<div className="my-4 grid grid-cols-3 gap-3">
					<div className="rounded-md bg-muted px-3 py-3">
						<span className="text-xs text-muted-foreground">Opening</span>
						<strong className="mt-1 block text-sm tabular-nums">
							{money(gap.openingBalance)}
						</strong>
					</div>
					<div className="rounded-md bg-muted px-3 py-3">
						<span className="text-xs text-muted-foreground">Money in</span>
						<strong className="mt-1 block text-sm tabular-nums">
							+{money(summary.moneyIn)}
						</strong>
					</div>
					<div className="rounded-md bg-muted px-3 py-3">
						<span className="text-xs text-muted-foreground">Money out</span>
						<strong className="mt-1 block text-sm tabular-nums">
							−{money(summary.moneyOut)}
						</strong>
					</div>
				</div>
				<h3 className="mt-4 mb-1 text-sm">Before the payment</h3>
				<p className="text-sm leading-relaxed text-muted-foreground">
					Opening balance {money(gap.openingBalance)} on{" "}
					{dateLabel(gap.windowStartDate, true)} · {summary.rows.length}{" "}
					transactions in execution order · Later deposits excluded
				</p>
				{/* oxlint-disable jsx-a11y/no-redundant-roles -- Safari removes semantics from unstyled grid lists. */}
				<ul className="mt-3 mb-0 grid list-none p-0" role="list">
					{summary.rows.map((row) => (
						<li
							key={row.id}
							className="flex items-center gap-3 border-t border-border py-3 text-xs"
						>
							<FundingTransactionIcon kind={row.kind} />
							<div className="min-w-0 flex-1">
								<div>{row.name}</div>
								<small className="text-xs text-muted-foreground">
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
								<small className="text-xs text-muted-foreground">
									→ {money(row.balanceAfter)}
								</small>
							</div>
						</li>
					))}
				</ul>
				{/* oxlint-enable jsx-a11y/no-redundant-roles */}
				<div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-danger-border bg-danger-bg p-3">
					<span className="flex items-center gap-3">
						<TriangleAlert size={18} aria-hidden="true" />
						<span>
							<strong className="text-xs">{gap.name}</strong>
							<br />
							<small className="text-muted-foreground">
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
				<p className="pt-3 text-sm leading-relaxed text-muted-foreground">
					<CalendarDays
						size={13}
						aria-hidden="true"
						className="inline align-middle"
					/>{" "}
					Projected schedule · Local {gap.fundingAccount.name} cash flow only —
					transfers are not household income or expenses.
				</p>
			</DialogContent>
		</Dialog>
	);
}

export type { FundingGap };
