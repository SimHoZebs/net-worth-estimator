import { Check, Flag, Pin, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useId } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import { useSelectedEntry } from "@/components/entrySelection.ts";
import type { EvaluationPin } from "@/components/evaluationCard.ts";
import { Progress, ProgressLabel } from "@/components/ui/progress.tsx";
import { SegmentedBar } from "@/components/SegmentedBar.tsx";
import { cn } from "@/lib/utils.ts";
import {
	independenceFunding,
	independenceHorizon,
	type FinancialIndependenceRange,
	type IndependenceCandidate,
} from "@/domain/financialIndependence.ts";
import { dateLabel, money, percent } from "@/domain/format.ts";
import type { OtherEvaluation } from "@/domain/result.ts";
import { IndependenceVerdict } from "./IndependenceVerdict.tsx";

const FinancialIndependenceModal = lazy(() =>
	import("./FinancialIndependenceModal.tsx").then((module) => ({
		default: module.FinancialIndependenceModal,
	})),
);

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
	const [inspector, setInspector] = useSelectedEntry<true>(null);
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
				role="region"
				aria-labelledby={headingId}
				className={cn(
					"relative flex h-full w-full min-w-0 max-w-2xl flex-col gap-4 overflow-visible rounded-surface border p-5 text-base text-ink ring-0 print:break-inside-avoid",
					item.enabled ? "border-line bg-surface" : "border-line bg-surface-2",
				)}
			>
				{item.enabled && analysis && (
					<button
						type="button"
						aria-haspopup="dialog"
						aria-label={`Inspect independence for ${item.name}`}
						onClick={() => setInspector(true)}
						className="absolute inset-0 cursor-pointer rounded-surface border-0 bg-transparent p-0"
					/>
				)}
				<div className="relative flex items-start justify-between gap-3">
					<h2
						id={headingId}
						className="m-0 flex min-h-8 items-center gap-2 text-sm leading-[1.5] font-semibold [overflow-wrap:anywhere]"
					>
						<StateIcon
							size={16}
							aria-hidden="true"
							className="shrink-0 text-primary"
						/>
						{item.name}
					</h2>
					{pin?.onPinChange && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							title={`${pin.pinned ? "Unpin" : "Pin"} ${item.name} ${pin.pinned ? "from" : "to"} Outlook`}
							aria-label={`${pin.pinned ? "Unpin" : "Pin"} ${item.name} ${pin.pinned ? "from" : "to"} Outlook`}
							onClick={pin.onPinChange}
							disabled={pin.disabled}
							aria-pressed={pin.pinned}
							className="relative z-(--z-local) aria-pressed:bg-success-bg aria-pressed:text-success-text"
						>
							<Pin size={16} aria-hidden="true" />
						</Button>
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
									value={Math.min(
										100,
										Math.max(
											0,
											Math.round(
												(horizon.availableYears! / horizon.requiredYears!) *
													100,
											),
										),
									)}
									className="[&_[data-slot=progress-indicator]]:bg-warning-text [&_[data-slot=progress-track]]:bg-warning-bg"
								>
									<ProgressLabel className="sr-only">
										Available projection horizon
									</ProgressLabel>
								</Progress>
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
										className="relative z-(--z-local) flex min-h-6 items-center gap-1 border-0 bg-transparent p-0 text-left text-xs text-warning-text pointer-coarse:min-h-12"
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
								<Badge
									variant={reached ? "default" : "secondary"}
									className={cn(
										"inline-flex h-auto w-fit items-center gap-1 rounded-control px-2 py-1 text-xs leading-snug font-medium whitespace-nowrap capitalize",
										reached
											? "bg-success-bg text-success-text"
											: "bg-surface-3 text-muted",
									)}
								>
									{reached ? "Satisfied" : "Evidence unavailable"}
								</Badge>
							</>
						)}
					</>
				)}
			</Card>
			{item.enabled && analysis && inspector !== null && (
				<Suspense fallback={null}>
					<FinancialIndependenceModal
						item={item}
						analysis={analysis}
						range={range}
						onClose={() => setInspector(null)}
					/>
				</Suspense>
			)}
		</>
	);
}
