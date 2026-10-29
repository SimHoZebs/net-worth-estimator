import { Check, Flag, Pin, TriangleAlert } from "lucide-react";
import { useId } from "react";
import { Badge } from "@/components/Badge.tsx";
import { IconButton } from "@/components/Button.tsx";
import { Card } from "@/components/Card.tsx";
import { useSelectedEntry } from "@/components/entrySelection.ts";
import type { EvaluationPin } from "@/components/evaluationCard.ts";
import { Progress } from "@/components/Progress.tsx";
import { SegmentedBar } from "@/components/SegmentedBar.tsx";
import {
	independenceFunding,
	independenceHorizon,
	type FinancialIndependenceRange,
	type IndependenceCandidate,
} from "@/domain/financialIndependence.ts";
import { dateLabel, money, percent } from "@/domain/format.ts";
import type { OtherEvaluation } from "@/domain/result.ts";
import { FinancialIndependenceModal } from "./FinancialIndependenceModal.tsx";
import { IndependenceVerdict } from "./IndependenceVerdict.tsx";

function CoveragePreview({ candidate }: { candidate: IndependenceCandidate }) {
	const funding = independenceFunding(candidate);
	if (!funding) return null;
	const {
		income: annualIncome,
		withdrawals: annualWithdrawals,
		spending: annualSpending,
		coverage,
		gap,
	} = funding;
	return (
		<div className="grid gap-2">
			<div className="flex justify-between gap-2 text-xs text-muted">
				<span>Coverage · {dateLabel(candidate.date)}</span>
				<strong className="type-value text-ink">{percent(coverage)}</strong>
			</div>
			<SegmentedBar
				caption="Spending coverage"
				showDetails={false}
				ariaLabel={`Spending coverage at ${dateLabel(candidate.date)}: ${money(annualIncome)} income, ${money(annualWithdrawals)} withdrawal capacity, ${money(gap)} uncovered of ${money(annualSpending)} annual spending.`}
				segments={[
					{
						label: "Income",
						amount: annualIncome,
						pattern: "solid",
						tone: "sage",
					},
					{
						label: "Withdrawals",
						amount: annualWithdrawals,
						pattern: "dots",
						tone: "blue",
					},
					{ label: "Uncovered", amount: gap, pattern: "hatch", tone: "tan" },
				]}
			/>
		</div>
	);
}

export function FinancialIndependenceCard({
	item,
	pin = null,
	range = null,
}: {
	item: OtherEvaluation;
	pin?: EvaluationPin | null;
	range?: FinancialIndependenceRange | null;
}) {
	const headingId = useId();
	const analysis = item.financialIndependence;
	const [inspector, setInspector] = useSelectedEntry<true>(analysis);
	const candidate =
		analysis?.candidates.find((row) => row.date === analysis.defaultDate) ??
		analysis?.candidates[0];
	const horizon = analysis ? independenceHorizon(analysis) : null;
	const reached =
		analysis?.firstSelfSustainingDate ??
		(!analysis && item.status === "satisfied" ? item.outcomeDate : null);
	const StateIcon = reached ? Check : Flag;
	return (
		<>
			<Card
				tone={item.enabled ? "default" : "subtle"}
				aria-labelledby={headingId}
				className="relative"
			>
				{item.enabled && analysis && (
					<button
						type="button"
						aria-haspopup="dialog"
						aria-label={`Inspect independence for ${item.name}`}
						onClick={() => setInspector(true)}
						className="absolute inset-0 cursor-pointer rounded-surface border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
					/>
				)}
				<div className="relative flex items-start justify-between gap-3">
					<h2
						id={headingId}
						className="m-0 flex min-h-8 items-center gap-2 text-sm font-semibold [overflow-wrap:anywhere]"
					>
						<StateIcon
							size={16}
							aria-hidden="true"
							className="shrink-0 text-primary"
						/>
						{item.name}
					</h2>
					{pin?.onPinChange && (
						<IconButton
							icon={Pin}
							size="sm"
							iconSize={16}
							label={`${pin.pinned ? "Unpin" : "Pin"} ${item.name} ${pin.pinned ? "from" : "to"} Outlook`}
							onClick={pin.onPinChange}
							disabled={pin.disabled}
							aria-pressed={pin.pinned}
							className="relative z-10 aria-pressed:bg-success-bg aria-pressed:text-success-text"
						/>
					)}
				</div>
				<IndependenceVerdict item={item} />
				{item.enabled && (
					<>
						{horizon?.tooShort ? (
							<div className="grid gap-2">
								<div className="flex justify-between gap-2 text-xs text-muted">
									<span>{horizon.availableYears}y horizon</span>
									<span>{horizon.requiredYears}y required</span>
								</div>
								<Progress
									label="Available projection horizon"
									value={
										(horizon.availableYears! / horizon.requiredYears!) * 100
									}
									tone="warning"
								/>
							</div>
						) : (
							candidate && <CoveragePreview candidate={candidate} />
						)}
						{analysis ? (
							<>
								{!!analysis.diagnostics.length && (
									<button
										type="button"
										aria-haspopup="dialog"
										onClick={() => setInspector(true)}
										className="relative z-10 flex min-h-6 items-center gap-1 border-0 bg-transparent p-0 text-left text-xs text-warning-text pointer-coarse:min-h-12"
									>
										<TriangleAlert size={14} aria-hidden="true" />
										{analysis.diagnostics.length} source or configuration{" "}
										{analysis.diagnostics.length === 1 ? "issue" : "issues"}
									</button>
								)}
							</>
						) : (
							<>
								{item.goal && (
									<p className="m-0 text-xs text-muted">{item.goal}</p>
								)}
								<Badge tone={reached ? "success" : "neutral"}>
									{reached ? "Satisfied" : "Evidence unavailable"}
								</Badge>
							</>
						)}
					</>
				)}
			</Card>
			{item.enabled && analysis && inspector !== null && (
				<FinancialIndependenceModal
					item={item}
					analysis={analysis}
					range={range}
					onClose={() => setInspector(null)}
				/>
			)}
		</>
	);
}
