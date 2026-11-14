import { Check, Flag, Pin } from "lucide-react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
	Card,
	CardHeader,
	CardTitle,
	CardAction,
	CardContent,
	CardFooter,
} from "@/components/ui/card.tsx";
import type { EvaluationPin } from "@/components/evaluationCard.ts";
import { Progress } from "@/components/ui/progress.tsx";
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
				"h-full w-full min-w-0 max-w-2xl print:break-inside-avoid",
				!item.enabled && "bg-muted",
			)}
		>
			<CardHeader>
				<CardTitle>
					<h2
						id={headingId}
						className="flex items-center gap-2 [overflow-wrap:anywhere]"
					>
						<StateIcon
							size={16}
							aria-hidden="true"
							className="shrink-0 text-success-text"
						/>
						<span>{item.name}</span>
					</h2>
				</CardTitle>
				{onPinChange && (
					<CardAction>
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
					</CardAction>
				)}
			</CardHeader>
			<CardContent>
				<div className="type-value-display mb-1 [overflow-wrap:anywhere]">
					{!item.enabled ? "Paused" : item.outcomeText}
				</div>
				{item.enabled && item.qualifier && (
					<p className="m-0 text-sm leading-relaxed text-muted-foreground">
						{item.qualifier}
					</p>
				)}
			</CardContent>
			<CardFooter className="mt-auto flex-col items-stretch gap-4">
				<div>
					<Badge
						variant={tone === "neutral" ? "secondary" : "default"}
						className={cn(
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
						<div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
							<span>{item.progress.current}</span>
							{item.progress.share && <span>{item.progress.share}</span>}
						</div>
						<Progress
							value={Math.min(
								100,
								Math.max(0, Math.round(item.progress.fraction * 100)),
							)}
							aria-label={item.name}
						/>
					</div>
				)}
			</CardFooter>
		</Card>
	);
}
