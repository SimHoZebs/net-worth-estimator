import { useEffect, useRef, useState, type Ref } from "react";
import type { AnalysisDuration } from "@/api/generated/model/analysisDuration.ts";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { findingLabel, providerLabel } from "@/domain/analysisFindings.ts";
import { useReviewAnalysisFinding } from "@/state/analyses.ts";
import { Badge } from "../Badge.tsx";
import { Button } from "../Button.tsx";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { InputField, SelectField } from "../Field.tsx";

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
	const consumedDurationFocus = useRef(0);
	const [durationFocusRequest, setDurationFocusRequest] = useState(0);
	const [focusSummary, setFocusSummary] = useState(0);
	const editButton = useRef<HTMLButtonElement>(null);
	const review = finding.review;
	const confirmed = review?.decision === "confirmed";
	const duration = review?.duration;
	const provider = providerLabel(review?.provider ?? finding.provider);
	const focusDurationInput = () => {
		setDurationFocusRequest((previous) => previous + 1);
	};
	useEffect(() => {
		if (
			durationFocusRequest > consumedDurationFocus.current &&
			!feedback.isPending &&
			durationInput.current
		) {
			durationInput.current.focus();
			consumedDurationFocus.current = durationFocusRequest;
		}
	}, [durationFocusRequest, feedback.isPending, confirmed, editDuration]);
	useEffect(() => {
		if (focusSummary > 0) editButton.current?.focus();
	}, [focusSummary]);
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
					setChangeAnswer(false);
					focusDurationInput();
				},
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
						<Button size="sm" onClick={() => answer("confirm")}>
							Yes
						</Button>
						<Button
							size="sm"
							variant="secondary"
							onClick={() => answer("reject")}
						>
							No
						</Button>
					</div>
				</fieldset>
			) : (
				<div className="flex flex-wrap items-center gap-2">
					<Badge tone="neutral">{findingLabel(finding)}</Badge>
					{finding.stale && <Badge tone="warning">Awaiting analysis</Badge>}
					<span className="text-sm">
						{provider}
						{duration
							? ` · ${duration.count} ${duration.count === 1 ? duration.unit.slice(0, -1) : duration.unit}`
							: ""}
					</span>
					{!readOnly && (
						<Button
							ref={editButton}
							size="sm"
							variant="secondary"
							disabled={finding.stale || feedback.isPending}
							onClick={() => {
								focusDurationInput();
								setChangeAnswer(true);
								setEditDuration(true);
							}}
						>
							Change
						</Button>
					)}
				</div>
			)}
			{confirmed && !readOnly && (!duration || editDuration) && (
				<PlanDuration
					key={`${finding.id}-${finding.feedbackRevision}`}
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
									setEditDuration(false);
									setChangeAnswer(false);
									setFocusSummary((previous) => previous + 1);
								},
							},
						);
					}}
				/>
			)}
			{feedback.isError && (
				<ErrorNotice
					message={
						"status" in feedback.error && feedback.error.status === 409
							? "This finding changed. Check your answer and try again."
							: "Your answer could not be saved. Try again."
					}
				/>
			)}
		</div>
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
					<InputField
						ref={inputRef}
						label="Duration"
						type="number"
						inputMode="numeric"
						min={1}
						max={5200}
						step={1}
						required
						value={count}
						onChange={(event) => setCount(event.target.value)}
						containerClassName="w-24"
					/>
					<SelectField
						label="Unit"
						value={unit}
						onChange={(event) =>
							setUnit(event.target.value as AnalysisDuration["unit"])
						}
					>
						<option value="weeks">Weeks</option>
						<option value="months">Months</option>
					</SelectField>
					<Button type="submit" size="sm">
						Save
					</Button>
				</div>
			</fieldset>
		</form>
	);
}
