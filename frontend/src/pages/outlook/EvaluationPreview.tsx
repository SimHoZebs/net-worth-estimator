import { ArrowRight, ArrowUpRight, Flag } from "lucide-react";
import { Progress } from "../../components/ui.tsx";
import { dateLabel, money, percent } from "../../domain/format.ts";
import type { EvaluationResult, RangeResult } from "../../domain/result.ts";

export function EvaluationPreview({
	result: evaluation,
	range,
	onEvaluations,
	onEvaluation,
	pending = false,
}: {
	result: EvaluationResult | null;
	range: RangeResult | null;
	onEvaluations: () => void;
	onEvaluation: (id: string) => void;
	pending?: boolean;
}) {
	// A null result with settled data genuinely means "nothing configured";
	// a null result with pending data is unknowable, so the card keeps its
	// frame and navigation while only outcome slots skeletonize.
	if (pending)
		return (
			<section className="evaluation-preview" aria-busy="true">
				<div className="section-top">
					<button type="button" className="text-button" onClick={onEvaluations}>
						All evaluations <ArrowUpRight size={16} />
					</button>
				</div>
				<span
					className="skeleton"
					style={{ width: 170, height: 18 }}
					aria-hidden="true"
				/>
				<span
					className="skeleton"
					style={{ width: 120, height: 30 }}
					aria-hidden="true"
				/>
				<span
					className="skeleton"
					style={{ width: "100%", height: 44 }}
					aria-hidden="true"
				/>
			</section>
		);
	return (
		<section className="evaluation-preview">
			<div className="section-top">
				<button type="button" className="text-button" onClick={onEvaluations}>
					All evaluations <ArrowUpRight size={16} />
				</button>
			</div>
			{evaluation ? (
				<>
					<div className="evaluation-preview-content">
						<div>
							<p>{evaluation.evaluation.name}</p>
							<div className="evaluation-date">
								{evaluation.current >= evaluation.evaluation.target
									? "Already there"
									: evaluation.firstDate
										? dateLabel(evaluation.firstDate)
										: "Beyond this horizon"}
							</div>
							<span className="muted">
								{evaluation.current >= evaluation.evaluation.target
									? "Met at the start of this plan"
									: "First reached in the base case"}
							</span>
						</div>
						<div className="evaluation-glyph" aria-hidden="true">
							<Flag size={30} strokeWidth={1.2} />
						</div>
					</div>
					<div className="progress-label">
						<span>{money(evaluation.current)} today</span>
						<span>{money(evaluation.evaluation.target)} evaluation</span>
					</div>
					<Progress
						value={(evaluation.current / evaluation.evaluation.target) * 100}
						label={evaluation.evaluation.name}
					/>
					<button
						type="button"
						className="evaluation-evidence-link text-button"
						onClick={() => onEvaluation(evaluation.evaluation.id)}
					>
						{range
							? `${percent(range.evaluationSuccess[evaluation.evaluation.id] ?? 0)} of scenarios reach this evaluation`
							: "See evaluation evidence"}{" "}
						<ArrowRight size={14} />
					</button>
				</>
			) : (
				<p className="muted">
					Add an evaluation to give your plan a destination.
				</p>
			)}
		</section>
	);
}
