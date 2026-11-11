import { useState } from "react";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import type { PatternToNewSchedulePreview } from "@/api/generated/model/patternToNewSchedulePreview.ts";
import {
	cadenceLabel,
	directionLabel,
	frequencyLabel,
	groupRecurringPatterns,
	patternTitle,
	recurringPatternStatus,
	type RecurringPattern,
} from "@/domain/recurringPatterns.ts";
import {
	useAddPatternToExistingSchedule,
	useCreatePatternToNewSchedule,
	useDismissAnalysisFinding,
	usePatternToExistingSchedulePreview,
	usePatternToNewSchedulePreview,
	useReviewAnalysisFinding,
} from "@/state/analyses.ts";
import { notifySuccess } from "@/state/notifications.ts";
import { useSavedAccounts } from "@/state/savedState.ts";
import { useTransactionCatalog } from "@/state/workspaceResources.ts";
import { Badge } from "../Badge.tsx";
import { Button } from "../Button.tsx";
import { DetailRow } from "../DetailRow.tsx";
import { ErrorNotice, FieldError } from "../ErrorNotice.tsx";
import { SelectField } from "../Field.tsx";
import { Modal } from "../Modal.tsx";

function answerInput(finding: AnalysisFinding, action: "confirm" | "reject") {
	return {
		id: finding.id,
		input: {
			requestId: crypto.randomUUID(),
			runId: finding.runId,
			revision: finding.feedbackRevision,
			action,
		},
	};
}

export function NewScheduleDialog({
	findingId,
	title,
	readOnly,
	eyebrow = "Repeating payment",
	onClose,
}: {
	findingId: string;
	title: string;
	readOnly: boolean;
	eyebrow?: string;
	onClose: () => void;
}) {
	const preview = usePatternToNewSchedulePreview(findingId);
	const create = useCreatePatternToNewSchedule();
	const accounts = useSavedAccounts();
	const [failed, setFailed] = useState(false);
	const plan = preview.data;
	const accountName =
		accounts?.find((account) => account.id === plan?.accountId)?.name ??
		plan?.accountId ??
		"";
	return (
		<Modal
			title={`Forecast plan for ${title}`}
			eyebrow={eyebrow}
			onClose={onClose}
		>
			{preview.isPending ? (
				<p className="text-sm text-muted">Loading the forecast plan…</p>
			) : preview.isError || !plan ? (
				<ErrorNotice message="The forecast plan could not be loaded. Try again." />
			) : (
				<div className="space-y-4">
					<dl className="m-0 space-y-2">
						<DetailRow label="Suggested schedule">
							{plan.schedule?.name ?? title}
						</DetailRow>
						<DetailRow label="Amount">
							{plan.schedule
								? `${plan.schedule.amount} ${plan.currency}`
								: `${plan.typicalAmount} ${plan.currency}`}
						</DetailRow>
						{plan.schedule && (
							<>
								<DetailRow label="Repeats">
									{frequencyLabel(plan.schedule.frequency)}
								</DetailRow>
								<DetailRow label="Starts">{plan.schedule.startDate}</DetailRow>
								<DetailRow label="Account">{accountName}</DetailRow>
							</>
						)}
					</dl>
					{plan.schedule && plan.upcoming && plan.upcoming.length > 0 && (
						<div>
							<h3 className="text-sm font-semibold">Upcoming</h3>
							<ul className="mb-0 mt-1 space-y-1 pl-4 text-sm text-muted">
								{plan.upcoming.map((item) => (
									<li key={item.date}>
										{item.date} · {item.amount} {plan.currency}
									</li>
								))}
							</ul>
						</div>
					)}
					<div>
						<h3 className="text-sm font-semibold">Recorded evidence</h3>
						<p className="mb-0 mt-1 text-sm text-muted">
							{evidenceSummary(plan)}
						</p>
					</div>
					{!plan.creatable && (
						<p className="m-0 text-sm text-muted">{plan.reason}</p>
					)}
					<FieldError
						message={failed ? "The schedule could not be created." : null}
					/>
					<div className="flex gap-2">
						<Button type="button" variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						{plan.creatable && !readOnly && (
							<Button
								type="button"
								variant="primary"
								disabled={create.isPending}
								onClick={() =>
									create.mutate(
										{ id: findingId },
										{
											onSuccess: (result) => {
												setFailed(false);
												notifySuccess(
													"forecast-schedule",
													`Forecast schedule “${result.value.name}” created.`,
												);
												onClose();
											},
											onError: () => setFailed(true),
										},
									)
								}
							>
								{create.isPending ? "Creating…" : "Create forecast schedule"}
							</Button>
						)}
					</div>
				</div>
			)}
		</Modal>
	);
}

function evidenceSummary(plan: PatternToNewSchedulePreview): string {
	const occurrences = plan.occurrences ?? [];
	const dates = occurrences.map((item) => item.date).sort();
	const range =
		dates.length > 1
			? `${dates[0]} to ${dates[dates.length - 1]}`
			: (dates[0] ?? "");
	return `${occurrences.length} recorded ${occurrences.length === 1 ? "payment" : "payments"} · ${plan.typicalAmount} ${plan.currency} typical · ${range}`;
}

export function ExistingScheduleDialog({
	findingId,
	title,
	names,
	readOnly,
	heading = "Link repeating payments to a schedule",
	onClose,
}: {
	findingId: string;
	title: string;
	names: Map<string, string>;
	readOnly: boolean;
	heading?: string;
	onClose: () => void;
}) {
	const catalog = useTransactionCatalog();
	const schedules = (catalog.data?.items ?? []).filter(
		(item) => item.kind === "schedule",
	);
	const [scheduleId, setScheduleId] = useState("");
	const selected = scheduleId || schedules[0]?.id || "";
	const preview = usePatternToExistingSchedulePreview(
		findingId,
		selected ? selected : undefined,
	);
	const add = useAddPatternToExistingSchedule();
	const [added, setAdded] = useState<number | null>(null);
	const [addedSchedule, setAddedSchedule] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const plan = preview.data;
	return (
		<Modal title={heading} eyebrow={title} onClose={onClose}>
			<div className="space-y-4">
				<SelectField
					label="Existing forecast schedule"
					value={selected}
					onChange={(event) => {
						setScheduleId(event.target.value);
						setAdded(null);
						setAddedSchedule(null);
						setFailed(false);
					}}
				>
					<option value="">Choose a schedule…</option>
					{schedules.map((schedule) => (
						<option key={schedule.id} value={schedule.id}>
							{schedule.name}
						</option>
					))}
				</SelectField>
				{!selected ? (
					<p className="m-0 text-sm text-muted">
						Choose the forecast schedule these recorded payments belong to.
					</p>
				) : preview.isPending ? (
					<p className="text-sm text-muted">Checking the forecast schedule…</p>
				) : preview.isError || !plan ? (
					<ErrorNotice message="The link preview could not be loaded. Try again." />
				) : added !== null ? (
					<div className="space-y-3">
						<p className="m-0 text-sm">
							{added} recorded {added === 1 ? "payment" : "payments"} now{" "}
							{added === 1 ? "records" : "record"} an occurrence of “
							{addedSchedule ?? plan.scheduleName}”. Future movements stay on
							that schedule.
						</p>
						<Button type="button" variant="secondary" onClick={onClose}>
							Close
						</Button>
					</div>
				) : (
					<>
						{plan.assignments && plan.assignments.length > 0 && (
							<div>
								<h3 className="text-sm font-semibold">Matched occurrences</h3>
								<ul className="mb-0 mt-1 space-y-1 pl-4 text-sm text-muted">
									{plan.assignments.map((item) => (
										<li key={item.transactionId}>
											{names.get(item.transactionId) ?? item.transactionId} ·{" "}
											{item.date}
											{item.amount ? ` · ${item.amount}` : ""}
										</li>
									))}
								</ul>
							</div>
						)}
						{!plan.claimable && (
							<p className="m-0 text-sm text-muted">{plan.reason}</p>
						)}
						<FieldError
							message={failed ? "The payments could not be added." : null}
						/>
						<div className="flex gap-2">
							<Button type="button" variant="secondary" onClick={onClose}>
								Cancel
							</Button>
							{plan.claimable && !readOnly && (
								<Button
									type="button"
									variant="primary"
									disabled={add.isPending}
									onClick={() =>
										add.mutate(
											{ id: findingId, scheduleId: plan.scheduleId },
											{
												onSuccess: (result) => {
													setFailed(false);
													setAdded((result.matches ?? []).length);
													setAddedSchedule(plan.scheduleName);
												},
												onError: () => setFailed(true),
											},
										)
									}
								>
									{add.isPending ? "Linking…" : "Link payments to schedule"}
								</Button>
							)}
						</div>
					</>
				)}
			</div>
		</Modal>
	);
}

function PatternCard({
	pattern,
	names,
	readOnly,
}: {
	pattern: RecurringPattern;
	names: Map<string, string>;
	readOnly: boolean;
}) {
	const feedback = useReviewAnalysisFinding();
	const dismiss = useDismissAnalysisFinding();
	const [planOpen, setPlanOpen] = useState(false);
	const [linkOpen, setLinkOpen] = useState(false);
	const title = patternTitle(pattern, names);
	const confirmed = pattern.confirmed;
	const rejected = pattern.anchor.review?.decision === "rejected";
	const actionable = confirmed ?? pattern.anchor;
	return (
		<article className="space-y-2 rounded-control border border-solid border-line p-4">
			<div className="flex flex-wrap items-center gap-2">
				<h3 className="m-0 text-sm font-semibold">{title}</h3>
				<Badge tone={confirmed ? "success" : "neutral"}>
					{recurringPatternStatus(pattern)}
				</Badge>
			</div>
			<p className="m-0 text-xs text-muted">
				{cadenceLabel(pattern.cadence)} · {directionLabel(pattern.anchor.role)}{" "}
				· {pattern.findings.length} recorded
			</p>
			<FieldError
				message={
					feedback.isError || dismiss.isError
						? "The answer could not be saved."
						: null
				}
			/>
			<div className="flex flex-wrap gap-2">
				{!readOnly && rejected && (
					<Button
						type="button"
						size="sm"
						variant="secondary"
						disabled={dismiss.isPending}
						aria-label={`Review repeating pattern for ${title} again`}
						onClick={() =>
							dismiss.mutate({ id: pattern.anchor.id, dismissed: false })
						}
					>
						Review again
					</Button>
				)}
				<Button
					type="button"
					size="sm"
					variant={readOnly ? "secondary" : "primary"}
					aria-label={`${readOnly ? "Review forecast plan" : "Create forecast schedule"} for ${title}`}
					onClick={() => setPlanOpen(true)}
				>
					{readOnly ? "Review forecast plan" : "Create forecast schedule"}
				</Button>
				<Button
					type="button"
					size="sm"
					variant="secondary"
					aria-label={`Link repeating pattern for ${title} to an existing schedule`}
					onClick={() => setLinkOpen(true)}
				>
					Link to existing schedule
				</Button>
				{!readOnly && !confirmed && !rejected && (
					<Button
						type="button"
						size="sm"
						variant="secondary"
						disabled={feedback.isPending}
						aria-label={`Reject repeating pattern for ${title}`}
						onClick={() =>
							feedback.mutate(answerInput(pattern.anchor, "reject"))
						}
					>
						Not repeating
					</Button>
				)}
			</div>
			{planOpen && (
				<NewScheduleDialog
					findingId={actionable.id}
					title={title}
					readOnly={readOnly}
					onClose={() => setPlanOpen(false)}
				/>
			)}
			{linkOpen && (
				<ExistingScheduleDialog
					findingId={actionable.id}
					title={title}
					names={names}
					readOnly={readOnly}
					onClose={() => setLinkOpen(false)}
				/>
			)}
		</article>
	);
}

export function RecurringPatterns({
	findings,
	names,
	readOnly,
	label = "Repeating payments",
}: {
	findings: AnalysisFinding[];
	names: Map<string, string>;
	readOnly: boolean;
	label?: string;
}) {
	const patterns = groupRecurringPatterns(findings);
	if (patterns.length === 0) return null;
	return (
		<section className="space-y-4" aria-label={label}>
			<header className="space-y-2">
				<h2 className="m-0 text-lg font-semibold">Repeating payments</h2>
				<p className="m-0 text-sm text-muted">
					Create a forecast schedule or link payments to an existing schedule.
					Saving records your acceptance of the repeating pattern.
				</p>
			</header>
			{patterns.map((pattern) => (
				<PatternCard
					key={pattern.key}
					pattern={pattern}
					names={names}
					readOnly={readOnly}
				/>
			))}
		</section>
	);
}
