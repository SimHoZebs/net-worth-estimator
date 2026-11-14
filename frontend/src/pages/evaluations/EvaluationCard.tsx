import { Check, Flag, Pencil, Pin, Trash2 } from "lucide-react";
import { useId } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Card } from "@/components/ui/card.tsx";
import type { EvaluationPin } from "@/components/evaluationCard.ts";
import { Progress, ProgressLabel } from "@/components/ui/progress.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { cn } from "@/lib/utils.ts";
import { dateLabel, money } from "@/domain/format.ts";
import type { Evaluation } from "@/domain/model.ts";
import type { EvaluationResult } from "@/domain/result.ts";

export type { EvaluationPin } from "@/components/evaluationCard.ts";

export function EvaluationCard({
	evaluation,
	result,
	onEdit,
	onRemove,
	pending = false,
	pin = null,
}: {
	evaluation: Evaluation;
	result: Pick<EvaluationResult, "current" | "firstDate"> | undefined;
	onEdit?: () => void;
	onRemove?: () => void;
	pending?: boolean;
	pin?: EvaluationPin | null;
}) {
	const headingId = useId();
	const pinned = pin?.pinned ?? false;
	const onPinChange = pin?.onPinChange ?? null;
	const pinDisabled = pin?.disabled ?? false;
	// Outcome slots await the projection; everything else is model data and
	// stays live. Pending never fabricates zeros for not-yet-computed values.
	const outcomePending = evaluation.enabled && (pending || !result);
	const met = !outcomePending && result && result.current >= evaluation.target;
	const StateIcon = evaluation.enabled && met ? Check : Flag;
	return (
		<Card
			role="region"
			aria-labelledby={headingId}
			aria-busy={outcomePending}
			className={cn(
				"flex h-full w-full min-w-0 max-w-2xl flex-col gap-4 overflow-visible rounded-surface border p-5 text-base text-ink ring-0 print:break-inside-avoid",
				evaluation.enabled
					? "border-line bg-surface"
					: "border-line bg-surface-2",
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
					<span>{evaluation.name}</span>
				</h2>
				<div className="flex justify-end gap-1">
					{onPinChange && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							title={
								pinned
									? `Unpin ${evaluation.name} from Outlook`
									: `Pin ${evaluation.name} to Outlook`
							}
							aria-label={
								pinned
									? `Unpin ${evaluation.name} from Outlook`
									: `Pin ${evaluation.name} to Outlook`
							}
							onClick={onPinChange}
							disabled={pinDisabled}
							aria-pressed={pinned}
							className="aria-pressed:border-success-border aria-pressed:bg-success-bg aria-pressed:text-success-text"
						>
							<Pin size={16} aria-hidden="true" />
						</Button>
					)}
					{onEdit && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							title={`Edit ${evaluation.name}`}
							aria-label={`Edit ${evaluation.name}`}
							onClick={onEdit}
						>
							<Pencil size={16} aria-hidden="true" />
						</Button>
					)}
					{onRemove && (
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							title={`Remove ${evaluation.name}`}
							aria-label={`Remove ${evaluation.name}`}
							onClick={onRemove}
						>
							<Trash2 size={16} aria-hidden="true" />
						</Button>
					)}
				</div>
			</div>
			<div>
				<div className="type-value-display mt-0 mr-0 mb-1 ml-0">
					{!evaluation.enabled ? (
						"Paused"
					) : outcomePending ? (
						<Skeleton className="h-7 w-36" role="status" />
					) : met ? (
						"Already reached"
					) : result?.firstDate ? (
						dateLabel(result.firstDate)
					) : (
						"Beyond this horizon"
					)}
				</div>
				<div className="m-0 text-sm leading-relaxed text-muted">
					{outcomePending ? (
						<Skeleton className="h-4 w-44" role="status" />
					) : !evaluation.enabled ? (
						"Excluded from evaluation"
					) : met ? (
						"Met at the start of this model"
					) : result?.firstDate ? (
						"First reached in the projection"
					) : (
						"Not reached in the evaluated period"
					)}
				</div>
			</div>
			<div className="mt-auto flex flex-col gap-4">
				{evaluation.enabled &&
					(outcomePending ? (
						<Skeleton className="h-8 w-full" role="status" />
					) : (
						result && (
							<div className="m-0">
								<div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
									<span>{money(result.current)} today</span>
									<span>{money(evaluation.target)} target</span>
								</div>
								<Progress
									value={Math.min(
										100,
										Math.max(
											0,
											Math.round((result.current / evaluation.target) * 100),
										),
									)}
								>
									<ProgressLabel className="sr-only">
										{evaluation.name}
									</ProgressLabel>
								</Progress>
							</div>
						)
					))}
			</div>
		</Card>
	);
}
