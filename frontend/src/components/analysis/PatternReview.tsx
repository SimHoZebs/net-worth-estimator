import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	groupPatternReviews,
	reviewAmount,
	reviewCadenceLabel,
	reviewChips,
	reviewRecordedCount,
	reviewTitle,
	type PatternReviewRow,
	type PatternReviewTab,
} from "@/domain/patternReview.ts";
import {
	paymentStatus,
	type PaymentPattern,
} from "@/domain/paymentFindings.ts";
import {
	recurringPatternStatus,
	type RecurringPattern,
} from "@/domain/recurringPatterns.ts";
import {
	useDismissAnalysisFinding,
	useReviewAnalysisFinding,
} from "@/state/analyses.ts";
import { Badge } from "../Badge.tsx";
import { Button } from "../Button.tsx";
import { FieldError } from "../ErrorNotice.tsx";
import { Modal } from "../Modal.tsx";
import {
	ExistingScheduleDialog,
	NewScheduleDialog,
} from "./RecurringPatterns.tsx";

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

const TABS: { id: PatternReviewTab; label: string; empty: string }[] = [
	{ id: "review", label: "Review", empty: "No patterns need review." },
	{ id: "saved", label: "Saved", empty: "No saved patterns." },
	{ id: "dismissed", label: "Dismissed", empty: "No dismissed patterns." },
];

function ClassificationAnswers({
	pattern,
	title,
	readOnly,
}: {
	pattern: PaymentPattern;
	title: string;
	readOnly: boolean;
}) {
	const review = useReviewAnalysisFinding();
	const finding = pattern.anchor;
	const confirmed = finding.review?.decision === "confirmed";
	const rejected = finding.review?.decision === "rejected";
	const inactive = finding.stale || finding.status === "withdrawn";
	const busy = review.isPending;
	const kindLabel =
		finding.kind.charAt(0).toUpperCase() + finding.kind.slice(1);
	return (
		<div className="space-y-2">
			<p className="m-0 text-xs font-semibold">{kindLabel}</p>
			<div className="flex flex-wrap items-center gap-2">
				<Badge tone={confirmed ? "success" : "neutral"}>
					{paymentStatus(finding)}
				</Badge>
			</div>
			<FieldError
				message={review.isError ? "The answer could not be saved." : null}
			/>
			{!readOnly && (
				<div className="flex flex-wrap gap-2">
					<Button
						type="button"
						size="sm"
						variant="primary"
						disabled={busy || inactive || confirmed}
						aria-pressed={confirmed}
						aria-label={`Confirm ${finding.kind} for ${title}`}
						onClick={() => review.mutate(answerInput(finding, "confirm"))}
					>
						Confirm
					</Button>
					<Button
						type="button"
						size="sm"
						variant="secondary"
						disabled={busy || inactive || rejected}
						aria-pressed={rejected}
						aria-label={`Not ${finding.kind} for ${title}`}
						onClick={() => review.mutate(answerInput(finding, "reject"))}
					>
						Not {finding.kind}
					</Button>
				</div>
			)}
		</div>
	);
}

function RepetitionActions({
	pattern,
	title,
	names,
	readOnly,
}: {
	pattern: RecurringPattern;
	title: string;
	names: Map<string, string>;
	readOnly: boolean;
}) {
	const feedback = useReviewAnalysisFinding();
	const dismiss = useDismissAnalysisFinding();
	const [planOpen, setPlanOpen] = useState(false);
	const [linkOpen, setLinkOpen] = useState(false);
	const confirmed = pattern.confirmed;
	const rejected = pattern.anchor.review?.decision === "rejected";
	const actionable = confirmed ?? pattern.anchor;
	return (
		<div className="space-y-2">
			<p className="m-0 text-xs font-semibold">Repeating</p>
			<div className="flex flex-wrap items-center gap-2">
				<Badge tone={confirmed ? "success" : "neutral"}>
					{recurringPatternStatus(pattern)}
				</Badge>
			</div>
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
		</div>
	);
}

function PaymentForecastActions({
	finding,
	title,
	names,
	readOnly,
}: {
	finding: AnalysisFinding;
	title: string;
	names: Map<string, string>;
	readOnly: boolean;
}) {
	const [planOpen, setPlanOpen] = useState(false);
	const [linkOpen, setLinkOpen] = useState(false);
	const kindLabel =
		finding.kind.charAt(0).toUpperCase() + finding.kind.slice(1);
	return (
		<div className="space-y-2">
			<div className="flex flex-wrap gap-2">
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
					aria-label={`Link to existing schedule for ${title}`}
					onClick={() => setLinkOpen(true)}
				>
					Link to existing schedule
				</Button>
			</div>
			{planOpen && (
				<NewScheduleDialog
					findingId={finding.id}
					title={title}
					readOnly={readOnly}
					eyebrow={kindLabel}
					onClose={() => setPlanOpen(false)}
				/>
			)}
			{linkOpen && (
				<ExistingScheduleDialog
					findingId={finding.id}
					title={title}
					names={names}
					readOnly={readOnly}
					heading="Link recorded payments to a schedule"
					onClose={() => setLinkOpen(false)}
				/>
			)}
		</div>
	);
}

function PatternReviewDialog({
	row,
	names,
	readOnly,
	onClose,
}: {
	row: PatternReviewRow;
	names: Map<string, string>;
	readOnly: boolean;
	onClose: () => void;
}) {
	const visibility = useDismissAnalysisFinding();
	const title = reviewTitle(row, names);
	const amount = reviewAmount(row);
	const findings = row.findings.filter((finding) => !finding.dismissed);
	const dismissed = row.findings.filter((finding) => finding.dismissed);
	return (
		<Modal title={title} eyebrow="Pattern review" onClose={onClose}>
			<div className="space-y-4">
				<div className="space-y-1">
					<p className="m-0 text-xs text-muted">
						{reviewCadenceLabel(row)} · {reviewRecordedCount(row)} recorded
					</p>
					{amount && (
						<p
							className={
								amount.inflow
									? "m-0 text-xs font-semibold text-success-text"
									: "m-0 text-xs font-semibold"
							}
						>
							{amount.text} · {amount.direction}
						</p>
					)}
				</div>
				{row.payments.map((pattern) => (
					<ClassificationAnswers
						key={pattern.key}
						pattern={pattern}
						title={title}
						readOnly={readOnly}
					/>
				))}
				{row.repetition.map((pattern, index) => (
					<RepetitionActions
						key={`${pattern.key}:${index}`}
						pattern={pattern}
						title={title}
						names={names}
						readOnly={readOnly}
					/>
				))}
				{row.repetition.length === 0 &&
					row.payments.map((pattern) => (
						<PaymentForecastActions
							key={`forecast:${pattern.key}`}
							finding={pattern.anchor}
							title={title}
							names={names}
							readOnly={readOnly}
						/>
					))}
				<FieldError
					message={visibility.isError ? "The answer could not be saved." : null}
				/>
				{!readOnly && (
					<div className="flex flex-wrap gap-2">
						{findings.length > 0 && (
							<Button
								type="button"
								size="sm"
								variant="secondary"
								disabled={visibility.isPending}
								aria-label={`Dismiss pattern for ${title}`}
								onClick={() => {
									for (const finding of findings)
										visibility.mutate({ id: finding.id, dismissed: true });
								}}
							>
								Dismiss
							</Button>
						)}
						{dismissed.length > 0 && (
							<Button
								type="button"
								size="sm"
								variant="secondary"
								disabled={visibility.isPending}
								aria-label={`Restore pattern for ${title}`}
								onClick={() => {
									for (const finding of dismissed)
										visibility.mutate({ id: finding.id, dismissed: false });
								}}
							>
								Restore
							</Button>
						)}
					</div>
				)}
			</div>
		</Modal>
	);
}

export function PatternReview({
	findings,
	names,
	readOnly,
}: {
	findings: AnalysisFinding[];
	names: Map<string, string>;
	readOnly: boolean;
}) {
	const [tab, setTab] = useState<PatternReviewTab>("review");
	const [rows, setRows] = useState(5);
	const [openKey, setOpenKey] = useState<string | null>(null);
	const groups = groupPatternReviews(findings);
	if (!groups.length) return null;
	const counts = new Map<PatternReviewTab, number>();
	for (const row of groups) counts.set(row.tab, (counts.get(row.tab) ?? 0) + 1);
	const matching = groups.filter((row) => row.tab === tab);
	const active = TABS.find((entry) => entry.id === tab)!;
	const openRow = openKey
		? (groups.find((row) => row.key === openKey) ?? null)
		: null;
	return (
		<section className="space-y-4" aria-label="Pattern review">
			<header className="space-y-2">
				<h2 className="m-0 text-lg font-semibold">Pattern review</h2>
				<p className="m-0 text-sm text-muted">
					Confirm or correct suggested payment purposes.
				</p>
			</header>
			<div
				role="tablist"
				aria-label="Pattern review status"
				className="flex flex-wrap gap-2"
			>
				{TABS.map((entry) => (
					<Button
						key={entry.id}
						type="button"
						role="tab"
						aria-selected={tab === entry.id}
						variant={tab === entry.id ? "primary" : "secondary"}
						size="sm"
						onClick={() => {
							setTab(entry.id);
							setRows(5);
							setOpenKey(null);
						}}
					>
						{entry.label} ({counts.get(entry.id) ?? 0})
					</Button>
				))}
			</div>
			{matching.length === 0 ? (
				<p className="m-0 text-sm text-muted">{active.empty}</p>
			) : (
				<ul className="m-0 list-none space-y-2 p-0">
					{matching.slice(0, rows).map((row) => {
						const title = reviewTitle(row, names);
						const amount = reviewAmount(row);
						return (
							<li key={row.key}>
								<button
									type="button"
									aria-label={`Review ${title}`}
									onClick={() => setOpenKey(row.key)}
									className="flex w-full items-center gap-3 rounded-control border border-solid border-line p-4 text-left"
								>
									<span className="min-w-0 flex-1 space-y-1">
										<span className="block text-sm font-semibold">{title}</span>
										<span className="block text-xs text-muted">
											{reviewCadenceLabel(row)} · {reviewRecordedCount(row)}{" "}
											recorded
										</span>
										{amount && (
											<span
												className={
													amount.inflow
														? "block text-xs font-semibold text-success-text"
														: "block text-xs font-semibold"
												}
											>
												{amount.text} · {amount.direction}
											</span>
										)}
										<span className="flex flex-wrap gap-1 pt-1">
											{reviewChips(row).map((chip) => (
												<Badge key={chip.key} tone={chip.tone}>
													{chip.label}
												</Badge>
											))}
										</span>
									</span>
									<ChevronRight
										size={16}
										aria-hidden="true"
										className="flex-none text-muted"
									/>
								</button>
							</li>
						);
					})}
				</ul>
			)}
			{matching.length > rows && (
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => setRows((value) => value + 10)}
				>
					Show more patterns
				</Button>
			)}
			{openRow && (
				<PatternReviewDialog
					row={openRow}
					names={names}
					readOnly={readOnly}
					onClose={() => setOpenKey(null)}
				/>
			)}
		</section>
	);
}
