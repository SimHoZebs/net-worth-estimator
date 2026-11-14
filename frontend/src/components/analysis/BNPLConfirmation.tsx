import { useId, useRef, useState, type Ref } from "react";
import type { AnalysisDuration } from "@/api/generated/model/analysisDuration.ts";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { findingLabel, providerLabel } from "@/domain/analysisFindings.ts";
import { useReviewAnalysisFinding } from "@/state/analyses.ts";
import { ApiHttpError } from "@/api/http.ts";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { dismissKey, notifyError } from "@/state/notifications.ts";
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";

const fieldLabelClassName = "text-sm leading-normal font-semibold text-muted";
const fieldInputClassName =
	"h-11 bg-input-bg px-3 text-base text-ink placeholder:text-subtle disabled:bg-transparent focus-visible:outline-solid focus-visible:ring-0";
const fieldSelectClassName =
	"h-11 w-full rounded-control border border-solid border-line-strong bg-input-bg px-3 py-2 text-base font-normal text-ink placeholder:text-subtle disabled:cursor-not-allowed disabled:opacity-60";
const secondaryButtonClassName =
	"min-h-9 border-line-strong bg-surface px-3 py-2 text-xs leading-snug text-ink enabled:hover:bg-hover focus-visible:outline-solid focus-visible:ring-0";

// useReviewAnalysisFinding awaits its finding refetch before action completion.
// Schedule the action's focus handoff after React commits its new controls, without
// polling for a node or reacting to later background updates.
function focusAfterCommit(target: () => HTMLElement | null) {
	requestAnimationFrame(() => {
		const node = target();
		if (node?.isConnected && !node.matches(":disabled")) node.focus();
	});
}

export function BNPLConfirmation({
	finding,
	readOnly,
}: {
	finding: AnalysisFinding;
	readOnly: boolean;
}) {
	const feedback = useReviewAnalysisFinding();
	const [changeAnswer, setChangeAnswer] = useState(false);
	const [editDuration, setEditDuration] = useState(false);
	const durationInput = useRef<HTMLInputElement>(null);
	const changeButton = useRef<HTMLButtonElement>(null);
	const review = finding.review;
	const confirmed = review?.decision === "confirmed";
	const duration = review?.duration;
	const provider = providerLabel(review?.provider ?? finding.provider);
	function reportAnswerFailure(cause: unknown): void {
		if (cause instanceof UserScopeError) return;
		const message =
			cause instanceof ApiHttpError && cause.status === 409
				? "This finding changed."
				: "Your answer could not be saved.";
		notifyError("analysis-answer", message);
	}
	const answer = (action: "confirm" | "reject") => {
		feedback.mutate(
			{
				id: finding.id,
				input: {
					requestId: crypto.randomUUID(),
					runId: finding.runId,
					revision: finding.feedbackRevision,
					action,
				},
			},
			{
				onSuccess: () => {
					dismissKey("analysis-answer");
					setChangeAnswer(false);
					if (action === "confirm")
						focusAfterCommit(() => durationInput.current);
				},
				onError: reportAnswerFailure,
			},
		);
	};
	return (
		<div className="space-y-3">
			{(!confirmed || changeAnswer) && !readOnly && !finding.stale ? (
				<fieldset
					disabled={feedback.isPending || finding.stale}
					className="m-0 space-y-3 border-0 p-0"
				>
					<legend className="text-sm font-semibold">
						Is this a buy now, pay later payment from {provider}?
					</legend>
					<div className="flex gap-2">
						<Button
							size="sm"
							variant="secondary"
							className={secondaryButtonClassName}
							onClick={() => answer("confirm")}
						>
							Yes
						</Button>
						<Button
							size="sm"
							variant="secondary"
							className={secondaryButtonClassName}
							onClick={() => answer("reject")}
						>
							No
						</Button>
					</div>
				</fieldset>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					<Badge variant="secondary" className="h-auto bg-surface-3 text-muted">
						{findingLabel(finding)}
					</Badge>
					{finding.stale && (
						<Badge
							variant="default"
							className="h-auto bg-warning-bg text-warning-text"
						>
							Awaiting analysis
						</Badge>
					)}
					<span className="text-sm">
						{provider}
						{duration
							? ` · ${duration.count} ${duration.count === 1 ? duration.unit.slice(0, -1) : duration.unit}`
							: ""}
					</span>
					{!readOnly && (
						<Button
							ref={changeButton}
							size="sm"
							variant="secondary"
							className={secondaryButtonClassName}
							disabled={finding.stale || feedback.isPending}
							onClick={() => {
								setChangeAnswer(true);
								setEditDuration(true);
								focusAfterCommit(() => durationInput.current);
							}}
						>
							Change
						</Button>
					)}
				</div>
			)}
			{confirmed && !readOnly && (!duration || editDuration) && (
				<PlanDuration
					key={finding.id}
					duration={duration}
					inputRef={durationInput}
					busy={feedback.isPending}
					onSave={(next) => {
						feedback.mutate(
							{
								id: finding.id,
								input: {
									requestId: crypto.randomUUID(),
									runId: finding.runId,
									revision: finding.feedbackRevision,
									action: "set-duration",
									duration: next,
								},
							},
							{
								onSuccess: () => {
									dismissKey("analysis-answer");
									setEditDuration(false);
									setChangeAnswer(false);
									focusAfterCommit(() => changeButton.current);
								},
								onError: reportAnswerFailure,
							},
						);
					}}
				/>
			)}
		</div>
	);
}

function PlanDurationField({
	inputRef,
	count,
	onCount,
}: {
	inputRef: Ref<HTMLInputElement>;
	count: string;
	onCount: (value: string) => void;
}) {
	const id = useId();
	return (
		<Field className="flex w-24 min-w-0 flex-col gap-2">
			<Label htmlFor={id} className={fieldLabelClassName}>
				Duration
			</Label>
			<Input
				ref={inputRef}
				id={id}
				type="number"
				inputMode="numeric"
				min={1}
				max={5200}
				step={1}
				required
				value={count}
				onChange={(event) => onCount(event.target.value)}
				className={fieldInputClassName}
			/>
		</Field>
	);
}

function PlanDurationUnit({
	unit,
	onUnit,
}: {
	unit: AnalysisDuration["unit"];
	onUnit: (unit: AnalysisDuration["unit"]) => void;
}) {
	const id = useId();
	return (
		<Field className="flex min-w-0 flex-col gap-2">
			<Label htmlFor={id} className={fieldLabelClassName}>
				Unit
			</Label>
			<select
				id={id}
				value={unit}
				onChange={(event) =>
					onUnit(event.target.value as AnalysisDuration["unit"])
				}
				className={fieldSelectClassName}
			>
				<option value="weeks">Weeks</option>
				<option value="months">Months</option>
			</select>
		</Field>
	);
}

function PlanDuration({
	duration,
	inputRef,
	busy,
	onSave,
}: {
	duration?: AnalysisDuration;
	inputRef: Ref<HTMLInputElement>;
	busy: boolean;
	onSave: (duration: AnalysisDuration) => void;
}) {
	const [count, setCount] = useState(duration?.count.toString() ?? "");
	const [unit, setUnit] = useState<AnalysisDuration["unit"]>(
		duration?.unit ?? "months",
	);
	return (
		<form
			onSubmit={(event) => {
				event.preventDefault();
				const value = Number(count);
				if (Number.isInteger(value) && value >= 1 && value <= 5200)
					onSave({ count: value, unit });
			}}
		>
			<fieldset disabled={busy} className="m-0 space-y-3 border-0 p-0">
				<legend className="text-sm font-semibold">How long is the plan?</legend>
				<div className="flex flex-wrap items-end gap-2">
					<PlanDurationField
						inputRef={inputRef}
						count={count}
						onCount={setCount}
					/>
					<PlanDurationUnit unit={unit} onUnit={setUnit} />
					<Button
						type="submit"
						size="sm"
						variant="secondary"
						className={secondaryButtonClassName}
					>
						Save
					</Button>
				</div>
			</fieldset>
		</form>
	);
}
