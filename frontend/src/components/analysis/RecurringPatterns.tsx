import { useState } from "react";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import type { RecurringPromotionPreview } from "@/api/generated/model/recurringPromotionPreview.ts";
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
	useDismissAnalysisFinding,
	usePromoteRecurringPattern,
	useRecurringPreview,
	useReviewAnalysisFinding,
} from "@/state/analyses.ts";
import { useSavedAccounts } from "@/state/savedRows.ts";
import { Badge } from "../Badge.tsx";
import { Button } from "../Button.tsx";
import { DetailRow } from "../DetailRow.tsx";
import { ErrorNotice } from "../ErrorNotice.tsx";
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

function RecurringPlanDialog({
	findingId,
	title,
	readOnly,
	onClose,
}: {
	findingId: string;
	title: string;
	readOnly: boolean;
	onClose: () => void;
}) {
	const preview = useRecurringPreview(findingId);
	const promote = usePromoteRecurringPattern();
	const accounts = useSavedAccounts();
	const [created, setCreated] = useState<string | null>(null);
	const [failed, setFailed] = useState(false);
	const plan = preview.data;
	const accountName =
		accounts?.find((account) => account.id === plan?.accountId)?.name ??
		plan?.accountId ??
		"";
	return (
		<Modal
			title={`Forecast plan for ${title}`}
			eyebrow="Repeating payment"
			onClose={onClose}
		>
			{preview.isPending ? (
				<p className="text-sm text-muted">Loading the forecast plan…</p>
			) : preview.isError || !plan ? (
				<ErrorNotice message="The forecast plan could not be loaded. Try again." />
			) : created ? (
				<div className="space-y-3">
					<p className="m-0 text-sm">
						Forecast rule “{created}” created. Future {plan.rule ? frequencyLabel(plan.rule.frequency).toLowerCase() : ""} movements
						will appear in projections. The recorded payments below stay
						unchanged.
					</p>
					<Button type="button" variant="secondary" onClick={onClose}>
						Close
					</Button>
				</div>
			) : (
				<div className="space-y-4">
					<dl className="m-0 space-y-2">
						<DetailRow label="Suggested rule">{plan.rule?.name ?? title}</DetailRow>
						<DetailRow label="Amount">
							{plan.rule
								? `${plan.rule.amount} ${plan.currency}`
								: `${plan.typicalAmount} ${plan.currency}`}
						</DetailRow>
						{plan.rule && (
							<>
								<DetailRow label="Repeats">
									{frequencyLabel(plan.rule.frequency)}
								</DetailRow>
								<DetailRow label="Starts">{plan.rule.startDate}</DetailRow>
								<DetailRow label="Account">{accountName}</DetailRow>
							</>
						)}
					</dl>
					{plan.rule && plan.upcoming && plan.upcoming.length > 0 && (
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
					{!plan.promotable && (
						<p className="m-0 text-sm text-muted">{plan.reason}</p>
					)}
					{failed && (
						<ErrorNotice message="The rule could not be created. The plan above is current; review it and try again." />
					)}
					<div className="flex gap-2">
						<Button type="button" variant="secondary" onClick={onClose}>
							Cancel
						</Button>
						{plan.promotable && !readOnly && (
							<Button
								type="button"
								variant="primary"
								disabled={promote.isPending}
								onClick={() =>
									promote.mutate(
										{ id: findingId },
										{
											onSuccess: (result) => {
												setFailed(false);
												setCreated(result.row.name);
											},
											onError: () => setFailed(true),
										},
									)
								}
							>
								{promote.isPending ? "Creating…" : "Approve and create rule"}
							</Button>
						)}
					</div>
				</div>
			)}
		</Modal>
	);
}

function evidenceSummary(plan: RecurringPromotionPreview): string {
	const occurrences = plan.occurrences ?? [];
	const dates = occurrences.map((item) => item.date).sort();
	const range =
		dates.length > 1
			? `${dates[0]} to ${dates[dates.length - 1]}`
			: (dates[0] ?? "");
	return `${occurrences.length} recorded ${occurrences.length === 1 ? "payment" : "payments"} · ${plan.typicalAmount} ${plan.currency} typical · ${range}`;
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
				{cadenceLabel(pattern.cadence)} · {directionLabel(pattern.anchor.role)} ·{" "}
				{pattern.findings.length} recorded
			</p>
			{(feedback.isError || dismiss.isError) && (
				<ErrorNotice message="The answer could not be saved. Try again." />
			)}
			<div className="flex flex-wrap gap-2">
				{!readOnly && !confirmed && !rejected && (
					<>
						<Button
							type="button"
							size="sm"
							disabled={feedback.isPending}
							aria-label={`Confirm repeating pattern for ${title}`}
							onClick={() =>
								feedback.mutate(answerInput(pattern.anchor, "confirm"))
							}
						>
							Confirm
						</Button>
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
					</>
				)}
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
					variant="secondary"
					aria-label={`Review forecast plan for ${title}`}
					onClick={() => setPlanOpen(true)}
				>
					Review forecast plan
				</Button>
			</div>
			{planOpen && (
				<RecurringPlanDialog
					findingId={actionable.id}
					title={title}
					readOnly={readOnly}
					onClose={() => setPlanOpen(false)}
				/>
			)}
		</article>
	);
}

export function RecurringPatterns({
	findings,
	names,
	readOnly,
}: {
	findings: AnalysisFinding[];
	names: Map<string, string>;
	readOnly: boolean;
}) {
	const patterns = groupRecurringPatterns(findings);
	if (patterns.length === 0) return null;
	return (
		<section className="space-y-4" aria-label="Repeating payments">
			<header className="space-y-2">
				<h2 className="m-0 text-lg font-semibold">Repeating payments</h2>
				<p className="m-0 text-sm text-muted">
					Analysis groups saved bank records that repeat on a steady
					rhythm. Confirm a pattern, then review its forecast plan: the
					plan starts after the last recorded payment, so recorded
					history is never duplicated.
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
