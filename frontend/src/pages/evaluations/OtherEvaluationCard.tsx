import { Check, Flag, Pin } from "lucide-react";
import type { ComponentType } from "react";
import { IconButton } from "../../components/Button.tsx";
import type { OtherEvaluationCardProps } from "../../components/evaluationCard.ts";
import { FundingGapsCard } from "../../components/funding/FundingGapsCard.tsx";
import { mergeStyles } from "../../components/mergeStyles.ts";
import { Badge, Progress } from "../../components/ui.tsx";
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
	const pinned = pin?.pinned ?? false;
	const onPinChange = pin?.onPinChange ?? null;
	const pinDisabled = pin?.disabled ?? false;
	const satisfied = item.enabled && item.status === "satisfied";
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
			className={mergeStyles(
				evaluationCard({ enabled: item.enabled }),
				"p-8 max-lg:p-6",
			)}
		>
			<div className="flex items-center justify-between gap-4">
				<span className="grid size-11 place-items-center rounded-full bg-success-bg text-success-text">
					{satisfied ? <Check size={23} /> : <Flag size={23} />}
				</span>
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
			<h2 className="mt-5 text-xl font-semibold">{item.name}</h2>
			{item.goal && item.goal !== item.name && (
				<p className="my-2 text-xs">{item.goal}</p>
			)}
			<div className="type-value mt-6 mr-0 mb-1 ml-0 text-4xl font-medium leading-[1.2] tracking-tight">
				{!item.enabled
					? "Paused"
					: item.outcomeDate
						? dateLabel(item.outcomeDate)
						: item.outcomeText}
			</div>
			{item.enabled && item.qualifier && (
				<p className="my-2 px-6 py-5 text-xs leading-relaxed text-muted">
					{item.qualifier}
				</p>
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
				<div className="mt-6 mr-0 mb-4 ml-0">
					<div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted">
						<span>{item.progress.current}</span>
						{item.progress.share && <span>{item.progress.share}</span>}
					</div>
					<Progress value={item.progress.fraction * 100} label={item.name} />
				</div>
			)}
		</section>
	);
}
