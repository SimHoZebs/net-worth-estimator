import { Check, Flag, Pin } from "lucide-react";
import type { ComponentType } from "react";
import { useId } from "react";
import { IconButton } from "../../components/Button.tsx";
import type { OtherEvaluationCardProps } from "../../components/evaluationCard.ts";
import { FundingGapsCard } from "../../components/funding/FundingGapsCard.tsx";
import { Badge } from "../../components/Badge.tsx";
import { Progress } from "../../components/Progress.tsx";
import { dateLabel } from "../../domain/format.ts";
import type { OtherEvaluationType } from "../../domain/result.ts";
import { evaluationCard } from "./evaluationStyles.ts";

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
	const headingId = useId();
	const pinned = pin?.pinned ?? false;
	const onPinChange = pin?.onPinChange ?? null;
	const pinDisabled = pin?.disabled ?? false;
	const satisfied = item.enabled && item.status === "satisfied";
	const StateIcon = satisfied ? Check : Flag;
	const tone =
		!item.enabled || item.status === "indeterminate"
			? "neutral"
			: item.status === "satisfied"
				? "success"
				: item.status === "warning"
					? "warning"
					: "neutral";
	return (
		<section
			className={evaluationCard({ enabled: item.enabled })}
			aria-labelledby={headingId}
		>
			<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
				<h2
					id={headingId}
					className="m-0 flex min-h-8 items-center gap-2 text-sm font-semibold leading-[1.5] [overflow-wrap:anywhere]"
				>
					<StateIcon
						size={16}
						aria-hidden="true"
						className="shrink-0 text-success-text"
					/>
					<span>{item.name}</span>
				</h2>
				{onPinChange && (
					<div className="flex justify-end gap-1">
						<IconButton
							icon={Pin}
							size="sm"
							iconSize={16}
							className="aria-pressed:border-success-border aria-pressed:bg-success-bg aria-pressed:text-success-text"
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
			{item.goal && item.goal !== item.name && (
				<p className="m-0 text-xs text-muted">{item.goal}</p>
			)}
			<div>
				<div className="type-value mt-0 mr-0 mb-1 ml-0 text-3xl font-medium leading-[1.2] tracking-tight [overflow-wrap:anywhere]">
					{!item.enabled
						? "Paused"
						: item.outcomeDate
							? dateLabel(item.outcomeDate)
							: item.outcomeText}
				</div>
				{item.enabled && item.qualifier && (
					<p className="m-0 text-sm leading-relaxed text-muted">
						{item.qualifier}
					</p>
				)}
			</div>
			<div className="mt-auto flex flex-col gap-4">
				<div>
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
				</div>
				{item.enabled && item.progress && (
					<div className="m-0">
						<div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
							<span>{item.progress.current}</span>
							{item.progress.share && <span>{item.progress.share}</span>}
						</div>
						<Progress value={item.progress.fraction * 100} label={item.name} />
					</div>
				)}
			</div>
		</section>
	);
}
