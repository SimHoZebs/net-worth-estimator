import { Check, Flag, Pin, TriangleAlert } from "lucide-react";
import { lazy, Suspense, useId } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
	Card,
	CardHeader,
	CardTitle,
	CardAction,
	CardContent,
} from "@/components/ui/card.tsx";
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
			<div className="flex justify-between gap-2 text-xs text-muted-foreground">
				<span>Coverage · {dateLabel(candidate.date)}</span>
				<strong className="type-value text-foreground">
					{percent(coverage)}
				</strong>
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
					"relative h-full w-full min-w-0 max-w-2xl print:break-inside-avoid",
					!item.enabled && "bg-muted",
				)}
			>
				{item.enabled && analysis && (
					<button
						type="button"
						aria-haspopup="dialog"
						aria-label={`Inspect independence for ${item.name}`}
						onClick={() => setInspector(true)}
						className="absolute inset-0 cursor-pointer rounded-xl border-0 bg-transparent p-0"
					/>
				)}
				<CardHeader className="relative">
					<CardTitle>
						<h2
							id={headingId}
							className="flex items-center gap-2 [overflow-wrap:anywhere]"
						>
							<StateIcon
								size={16}
								aria-hidden="true"
								className="shrink-0 text-primary"
							/>
							{item.name}
						</h2>
					</CardTitle>
					{pin?.onPinChange && (
						<CardAction>
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
						</CardAction>
					)}
				</CardHeader>
				<CardContent className="grid gap-4">
					<IndependenceVerdict item={item} />
					{item.enabled && (
						<>
							{horizon?.tooShort ? (
								<div className="grid gap-2">
									<div className="flex justify-between gap-2 text-xs text-muted-foreground">
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
										<p className="m-0 text-xs text-muted-foreground">
											{item.goal}
										</p>
									)}
									<Badge
										variant={reached ? "default" : "secondary"}
										className={cn(reached && "bg-success-bg text-success-text")}
									>
										{reached ? "Satisfied" : "Evidence unavailable"}
									</Badge>
								</>
							)}
						</>
					)}
				</CardContent>
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
