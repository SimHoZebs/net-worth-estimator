import { useState } from "react";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	groupPaymentPatterns,
	paymentAmount,
	paymentStatus,
	paymentTitle,
	type PaymentPattern,
} from "@/domain/paymentFindings.ts";
import { cadenceLabel } from "@/domain/recurringPatterns.ts";
import { useReviewAnalysisFinding } from "@/state/analyses.ts";
import { Badge } from "@/components/Badge.tsx";
import { Button } from "@/components/Button.tsx";
import { FieldError } from "@/components/ErrorNotice.tsx";
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

function PatternCard({
	pattern,
	names,
	readOnly,
}: {
	pattern: PaymentPattern;
	names: Map<string, string>;
	readOnly: boolean;
}) {
	const review = useReviewAnalysisFinding();
	const [planOpen, setPlanOpen] = useState(false);
	const [linkOpen, setLinkOpen] = useState(false);
	const finding = pattern.anchor;
	const title = paymentTitle(pattern, names);
	const kindLabel =
		finding.kind.charAt(0).toUpperCase() + finding.kind.slice(1);
	const summary = finding.pattern!;
	const confirmed = finding.review?.decision === "confirmed";
	const inactive = finding.stale || finding.status === "withdrawn";
	const busy = review.isPending;
	return (
		<article className="space-y-2 rounded-control border border-solid border-line p-4">
			<div className="flex flex-wrap items-center gap-2">
				<h3 className="m-0 text-sm font-semibold">{title}</h3>
				<Badge tone={confirmed ? "success" : "neutral"}>
					{paymentStatus(finding)}
				</Badge>
			</div>
			<p className="m-0 text-xs text-muted">
				{paymentAmount(summary.typicalAmount, summary.currency)} typical ·{" "}
				{finding.product
					? cadenceLabel(finding.product)
					: "Repetition not established"}{" "}
				· {pattern.findings.length} recorded
			</p>
			<FieldError
				message={review.isError ? "The answer could not be saved." : null}
			/>
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
				{!readOnly && (
					<>
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
							disabled={
								busy || inactive || finding.review?.decision === "rejected"
							}
							aria-pressed={finding.review?.decision === "rejected"}
							aria-label={`Not ${finding.kind} for ${title}`}
							onClick={() => review.mutate(answerInput(finding, "reject"))}
						>
							Not {finding.kind}
						</Button>
					</>
				)}
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
		</article>
	);
}

export function PaymentFindings({
	findings,
	names,
	readOnly,
}: {
	findings: AnalysisFinding[];
	names: Map<string, string>;
	readOnly: boolean;
}) {
	const [rows, setRows] = useState(5);
	const patterns = groupPaymentPatterns(findings);
	if (!patterns.length) return null;
	return (
		<section className="space-y-4" aria-label="Payment patterns">
			<header className="space-y-2">
				<h2 className="m-0 text-lg font-semibold">Payment patterns</h2>
				<p className="m-0 text-sm text-muted">
					Confirm or correct suggested payment purposes.
				</p>
			</header>
			{patterns.slice(0, rows).map((pattern) => (
				<PatternCard
					key={pattern.key}
					pattern={pattern}
					names={names}
					readOnly={readOnly}
				/>
			))}
			{patterns.length > rows && (
				<Button
					type="button"
					variant="secondary"
					size="sm"
					onClick={() => setRows((value) => value + 10)}
				>
					Show more payment patterns
				</Button>
			)}
		</section>
	);
}
