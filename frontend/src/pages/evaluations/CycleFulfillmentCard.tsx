import { Check, Flag, Pin } from "lucide-react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import type { EvaluationPin } from "@/components/evaluationCard.ts";
import { Progress, ProgressLabel } from "@/components/ui/progress.tsx";
import { cn } from "@/lib/utils.ts";
import type { OtherEvaluation } from "@/domain/result.ts";

export function CycleFulfillmentCard({
	item,
	pin = null,
}: {
	item: OtherEvaluation;
	pin?: EvaluationPin | null;
}) {
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
		<Card
			role="region"
			aria-labelledby={headingId}
			className={cn(
				"flex h-full w-full min-w-0 max-w-2xl flex-col gap-4 overflow-visible rounded-surface border p-5 text-base text-ink ring-0 print:break-inside-avoid",
				item.enabled ? "border-line bg-surface" : "border-line bg-surface-2",
			)}
		>
			<div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
				<h2
					id={headingId}
					className="m-0 flex min-h-8 items-center gap-2 text-sm leading-[1.5] font-semibold [overflow-wrap:anywhere]"
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
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							title={
								pinned
									? `Unpin ${item.name} from Outlook`
									: `Pin ${item.name} to Outlook`
							}
							aria-label={
								pinned
									? `Unpin ${item.name} from Outlook`
									: `Pin ${item.name} to Outlook`
							}
							onClick={onPinChange}
							disabled={pinDisabled}
							aria-pressed={pinned}
							className="aria-pressed:border-success-border aria-pressed:bg-success-bg aria-pressed:text-success-text"
						>
							<Pin size={16} aria-hidden="true" />
						</Button>
					</div>
				)}
			</div>
			<div>
				<div className="type-value mt-0 mr-0 mb-1 ml-0 text-3xl leading-[1.2] font-medium tracking-tight [overflow-wrap:anywhere]">
					{!item.enabled ? "Paused" : item.outcomeText}
				</div>
				{item.enabled && item.qualifier && (
					<p className="m-0 text-sm leading-relaxed text-muted">
						{item.qualifier}
					</p>
				)}
			</div>
			<div className="mt-auto flex flex-col gap-4">
				<div>
					<Badge
						variant={tone === "neutral" ? "secondary" : "default"}
						className={cn(
							"inline-flex h-auto w-fit items-center gap-1 rounded-control px-2 py-1 text-xs leading-snug font-medium whitespace-nowrap capitalize",
							tone === "neutral" && "bg-surface-3 text-muted",
							tone === "success" && "bg-success-bg text-success-text",
							tone === "warning" && "bg-warning-bg text-warning-text",
						)}
					>
						{!item.enabled
							? "Excluded from evaluation"
							: item.status === "satisfied"
								? "Within budget"
								: item.status === "not-satisfied"
									? "Over budget"
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
						<Progress
							value={Math.min(
								100,
								Math.max(0, Math.round(item.progress.fraction * 100)),
							)}
						>
							<ProgressLabel className="sr-only">{item.name}</ProgressLabel>
						</Progress>
					</div>
				)}
			</div>
		</Card>
	);
}
