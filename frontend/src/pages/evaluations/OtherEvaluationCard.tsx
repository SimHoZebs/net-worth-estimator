import { Check, Flag, Pin } from "lucide-react";
import type { ComponentType } from "react";
import type { OtherEvaluationCardProps } from "../../components/evaluationCard.ts";
import { FundingGapsCard } from "../../components/funding/FundingGapsCard.tsx";
import { Badge, IconButton, Progress } from "../../components/ui.tsx";
import { dateLabel } from "../../domain/format.ts";
import type { OtherEvaluationType } from "../../domain/result.ts";
import "./evaluations.css";

const cardViews: Partial<
	Record<OtherEvaluationType, ComponentType<OtherEvaluationCardProps>>
> = {
	postingFulfillment: FundingGapsCard,
};

export function OtherEvaluationCard(props: OtherEvaluationCardProps) {
	const Card = cardViews[props.item.type] ?? EvaluationSummaryCard;
	return <Card {...props} />;
}

function EvaluationSummaryCard({ item, pin = null }: OtherEvaluationCardProps) {
	const pinned = pin?.pinned ?? false;
	const onPinChange = pin?.onPinChange ?? null;
	const pinDisabled = pin?.disabled ?? false;
	const satisfied = item.enabled && item.status === "satisfied";
	const tone =
		!item.enabled || item.status === "indeterminate"
			? "neutral"
			: item.status === "satisfied"
				? "green"
				: item.status === "warning"
					? "amber"
					: "neutral";
	return (
		<section className={`evaluation-card ${item.enabled ? "" : "is-excluded"}`}>
			<div className="section-top">
				<span className="evaluation-icon">
					{satisfied ? <Check size={23} /> : <Flag size={23} />}
				</span>
				{onPinChange && (
					<div className="table-actions">
						<IconButton
							icon={Pin}
							label={
								pinned
									? `Unpin ${item.name} from Outlook`
									: `Pin ${item.name} to Outlook`
							}
							onClick={onPinChange}
							disabled={pinDisabled}
							aria-pressed={pinned}
						/>
					</div>
				)}
			</div>
			<h2>{item.name}</h2>
			{item.goal && item.goal !== item.name && <p>{item.goal}</p>}
			<div className="evaluation-card-outcome type-value">
				{!item.enabled
					? "Paused"
					: item.outcomeDate
						? dateLabel(item.outcomeDate)
						: item.outcomeText}
			</div>
			{item.enabled && item.qualifier && (
				<p className="section-note">{item.qualifier}</p>
			)}
			<Badge tone={tone}>
				{!item.enabled
					? "Excluded from evaluation"
					: item.status === "satisfied"
						? "Satisfied"
						: item.status === "not-satisfied"
							? "Not satisfied"
							: item.status === "warning"
								? "Needs attention"
								: "Indeterminate"}
			</Badge>
			{item.enabled && item.progress && (
				<div className="evaluation-card-progress">
					<div className="progress-label">
						<span>{item.progress.current}</span>
						{item.progress.share && <span>{item.progress.share}</span>}
					</div>
					<Progress value={item.progress.fraction * 100} label={item.name} />
				</div>
			)}
		</section>
	);
}
