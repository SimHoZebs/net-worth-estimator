import { Progress, ProgressLabel } from "@/components/ui/progress.tsx";
import { cn } from "@/lib/utils.ts";
import {
	independenceHorizon,
	type FinancialIndependenceAnalysis,
	type FinancialIndependenceRange,
	type IndependenceCandidate,
} from "@/domain/financialIndependence.ts";
import { dateLabel } from "@/domain/format.ts";
import { IndependenceRange } from "./IndependenceRange.tsx";
import { IndependenceTimeline } from "./IndependenceTimeline.tsx";
import { IndependenceSpending } from "./IndependenceSpending.tsx";

function HorizonComparison({
	analysis,
}: {
	analysis: FinancialIndependenceAnalysis;
}) {
	const { availableYears, requiredYears } = independenceHorizon(analysis);
	return (
		<section
			className={cn(
				"flex min-w-0 flex-col gap-3 rounded-surface border border-line bg-surface p-4",
			)}
			aria-label="Projection horizon"
		>
			<div>
				<div className="mb-2 flex justify-between text-xs text-muted">
					<span>Horizon</span>
					<strong>{availableYears}y</strong>
				</div>
				<Progress
					value={Math.min(
						100,
						Math.max(0, Math.round((availableYears! / requiredYears!) * 100)),
					)}
					className="[&_[data-slot=progress-indicator]]:bg-warning-text [&_[data-slot=progress-track]]:bg-warning-bg"
				>
					<ProgressLabel className="sr-only">
						Available projection horizon
					</ProgressLabel>
				</Progress>
			</div>
			<div>
				<div className="mb-2 flex justify-between text-xs text-muted">
					<span>Assessment period</span>
					<strong>{requiredYears}y</strong>
				</div>
				<Progress value={100}>
					<ProgressLabel className="sr-only">
						Required assessment period
					</ProgressLabel>
				</Progress>
			</div>
			<p className="m-0 text-xs text-muted">
				Extend the projection to assess whether spending stays funded for{" "}
				{requiredYears} years.
			</p>
		</section>
	);
}

export function IndependenceOverview({
	analysis,
	range,
	candidate,
}: {
	analysis: FinancialIndependenceAnalysis;
	range: FinancialIndependenceRange | null;
	candidate: IndependenceCandidate | undefined;
}) {
	return (
		<div className="grid content-start gap-4">
			{independenceHorizon(analysis).tooShort ? (
				<HorizonComparison analysis={analysis} />
			) : candidate ? (
				<>
					<section
						className={cn(
							"flex min-w-0 flex-col gap-3 rounded-surface border border-line bg-surface p-4",
						)}
						aria-label="Spending coverage"
					>
						<p className="m-0 text-xs text-muted">
							Funding as of {dateLabel(candidate.date)}
						</p>
						{analysis.firstSelfSustainingDate && (
							<p className="m-0 text-xs text-success-text">
								Self-sustaining · {dateLabel(analysis.firstSelfSustainingDate)}
							</p>
						)}
						<IndependenceSpending candidate={candidate} />
					</section>
					<details
						className={cn(
							"flex min-w-0 flex-col gap-3 rounded-surface border border-line bg-surface p-4",
						)}
					>
						<summary className="cursor-pointer text-xs font-semibold text-ink">
							Compare start dates
						</summary>
						<p className="m-0 text-xs text-muted">
							Income and withdrawal capacity at each possible start date, as a
							share of annual spending.
						</p>
						<IndependenceTimeline analysis={analysis} candidate={candidate} />
					</details>
				</>
			) : (
				<p className="m-0 text-xs text-muted">
					Start-date evidence is unavailable.
				</p>
			)}
			<section
				className={cn(
					"flex min-w-0 flex-col gap-3 rounded-surface border border-line bg-surface p-4",
				)}
				aria-label="Independence across scenarios"
			>
				<h3 className="m-0 text-xs font-semibold text-ink">
					Independence across scenarios
				</h3>
				<IndependenceRange
					range={range}
					required={analysis.requiredConfidence}
				/>
			</section>
		</div>
	);
}
