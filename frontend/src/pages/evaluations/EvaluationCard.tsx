import { Check, Flag, Pencil, Pin, Trash2 } from "lucide-react";
import { useId } from "react";
import { IconButton } from "@/components/Button.tsx";
import type { EvaluationPin } from "@/components/evaluationCard.ts";
import { mergeStyles } from "@/components/mergeStyles.ts";
import { Progress } from "@/components/Progress.tsx";
import { Skeleton } from "@/components/Skeleton.tsx";
import { dateLabel, money, percent } from "@/domain/format.ts";
import type { Evaluation } from "@/domain/model.ts";
import type { EvaluationResult } from "@/domain/result.ts";

export type { EvaluationPin } from "@/components/evaluationCard.ts";

export function EvaluationCard({
	evaluation,
	result,
	probability,
	onEdit,
	onRemove,
	pending = false,
	pin = null,
}: {
	evaluation: Evaluation;
	result: Pick<EvaluationResult, "current" | "firstDate"> | undefined;
	probability: number | null;
	onEdit?: () => void;
	onRemove?: () => void;
	pending?: boolean;
	pin?: EvaluationPin | null;
}) {
	const headingId = useId();
	const pinned = pin?.pinned ?? false;
	const onPinChange = pin?.onPinChange ?? null;
	const pinDisabled = pin?.disabled ?? false;
	// Outcome slots await the projection; everything else is plan data and
	// stays live. Pending never fabricates zeros for not-yet-computed values.
	const outcomePending = evaluation.enabled && (pending || !result);
	const met = !outcomePending && result && result.current >= evaluation.target;
	const StateIcon = evaluation.enabled && met ? Check : Flag;
	return (
		<section
			className={mergeStyles(
				"flex h-full w-full min-w-0 flex-col gap-4 rounded-surface border border-line p-5 print:break-inside-avoid",
				evaluation.enabled ? "bg-surface" : "bg-surface-2",
			)}
			aria-labelledby={headingId}
			aria-busy={outcomePending}
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
					<span>{evaluation.name}</span>
				</h2>
				<div className="flex justify-end gap-1">
					{onPinChange && (
						<IconButton
							icon={Pin}
							size="sm"
							iconSize={16}
							className="aria-pressed:border-success-border aria-pressed:bg-success-bg aria-pressed:text-success-text"
							label={
								pinned
									? `Unpin ${evaluation.name} from Outlook`
									: `Pin ${evaluation.name} to Outlook`
							}
							onClick={onPinChange}
							disabled={pinDisabled}
							aria-pressed={pinned}
						/>
					)}
					{onEdit && (
						<IconButton
							icon={Pencil}
							size="sm"
							iconSize={16}
							label={`Edit ${evaluation.name}`}
							onClick={onEdit}
						/>
					)}
					{onRemove && (
						<IconButton
							icon={Trash2}
							size="sm"
							iconSize={16}
							label={`Remove ${evaluation.name}`}
							onClick={onRemove}
						/>
					)}
				</div>
			</div>
			<div>
				<div className="type-value mt-0 mr-0 mb-1 ml-0 text-3xl font-medium leading-[1.2] tracking-tight [overflow-wrap:anywhere]">
					{!evaluation.enabled ? (
						"Paused"
					) : outcomePending ? (
						<Skeleton className="h-7 w-36" />
					) : met ? (
						"Already reached"
					) : result?.firstDate ? (
						dateLabel(result.firstDate)
					) : (
						"Beyond this horizon"
					)}
				</div>
				<p className="m-0 text-sm leading-relaxed text-muted">
					{outcomePending ? (
						<Skeleton className="h-4 w-44" />
					) : !evaluation.enabled ? (
						"Excluded from evaluation"
					) : met ? (
						"Met at the start of this plan"
					) : result?.firstDate ? (
						"First reached in the base case"
					) : (
						"Not reached in the evaluated period"
					)}
				</p>
			</div>
			<div className="mt-auto flex flex-col gap-4">
				{evaluation.enabled &&
					(outcomePending ? (
						<Skeleton className="h-8 w-full" />
					) : (
						result && (
							<div className="m-0">
								<div className="mb-2 flex flex-wrap items-center justify-between gap-3 text-xs text-muted">
									<span>{money(result.current)} today</span>
									<span>{money(evaluation.target)} target</span>
								</div>
								<Progress
									value={(result.current / evaluation.target) * 100}
									label={evaluation.name}
								/>
							</div>
						)
					))}
				{probability !== null && evaluation.enabled && !outcomePending && (
					<p className="m-0 text-xs">
						Reached in <strong>{percent(probability)}</strong> of modeled
						scenarios.
					</p>
				)}
			</div>
		</section>
	);
}
