import { useState } from "react";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	groupPaymentPatterns,
	paymentAmount,
	paymentLabel,
	paymentStatus,
} from "@/domain/paymentFindings.ts";
import { cadenceLabel } from "@/domain/recurringPatterns.ts";
import {
	useDismissAnalysisFinding,
	useReviewAnalysisFinding,
} from "@/state/analyses.ts";
import { Badge } from "@/components/Badge.tsx";
import { Button } from "@/components/Button.tsx";
import {
	DataTable,
	TableCell,
	TableHeader,
	TableRow,
} from "@/components/DataTable.tsx";
import { ErrorNotice } from "@/components/ErrorNotice.tsx";
import { RecurringPatterns } from "./RecurringPatterns.tsx";

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

export function PaymentFindings({
	findings,
	names,
	readOnly,
	repetition = [],
}: {
	findings: AnalysisFinding[];
	names: Map<string, string>;
	readOnly: boolean;
	repetition?: AnalysisFinding[];
}) {
	const review = useReviewAnalysisFinding();
	const dismiss = useDismissAnalysisFinding();
	const [rows, setRows] = useState(5);
	const patterns = groupPaymentPatterns(findings);
	const repetitionByStream = new Map<string, AnalysisFinding[]>();
	for (const item of repetition) {
		if (!item.streamId) continue;
		const key = JSON.stringify([item.streamId, item.status]);
		const items = repetitionByStream.get(key);
		if (items) items.push(item);
		else repetitionByStream.set(key, [item]);
	}
	if (!patterns.length) return null;
	const busy = review.isPending || dismiss.isPending;
	return (
		<section className="space-y-3" aria-label="Payment patterns">
			<header className="space-y-1">
				<h2 className="m-0 text-lg font-semibold">Payment patterns</h2>
				<p className="m-0 text-sm text-muted">
					Confirm or correct suggested payment purposes.
				</p>
			</header>
			<ErrorNotice
				message={
					review.isError || dismiss.isError
						? "The answer could not be saved."
						: null
				}
			/>
			<DataTable
				caption="Detected payment patterns"
				showHeaders
				columns={[
					{ label: "Payment" },
					{ label: "Annual estimate" },
					{ label: "Review" },
				]}
			>
				{patterns.slice(0, rows).map((pattern) => {
					const finding = pattern.anchor;
					const related =
						repetitionByStream.get(
							JSON.stringify([finding.streamId, finding.status]),
						) ?? [];
					const summary = finding.pattern!;
					const title = names.get(finding.transactionId) ?? finding.provider;
					const inactive = finding.stale || finding.status === "withdrawn";
					const status =
						inactive || finding.dismissed
							? paymentStatus(finding)
							: paymentLabel(finding);
					const depositCount = new Set(
						finding.evidence?.flatMap((item) => item.transactionIds ?? []),
					).size;
					return (
						<TableRow key={pattern.key}>
							<TableHeader
								scope="row"
								className="min-w-64 whitespace-normal align-top"
							>
								<div className="flex flex-wrap items-center gap-2">
									<span className="font-semibold">{title}</span>
									<Badge tone="neutral">{status}</Badge>
									{related.some((item) => !item.stale) && (
										<Badge tone="neutral">Repetition assessed</Badge>
									)}
								</div>
								<p className="mb-0 mt-1 text-xs text-muted">
									{paymentAmount(summary.typicalAmount, summary.currency)} ·{" "}
									{finding.product
										? cadenceLabel(finding.product)
										: "Repetition not established"}{" "}
									· {depositCount}{" "}
									{finding.role === "inflow"
										? depositCount === 1
											? "deposit"
											: "deposits"
										: depositCount === 1
											? "payment"
											: "payments"}
								</p>
								<details className="mt-2 text-xs font-normal text-muted">
									<summary className="cursor-pointer">
										Details<span className="sr-only"> for {title}</span>
									</summary>
									<ul className="mb-0 mt-2 space-y-1 pl-4">
										{finding.evidence?.map((evidence) => (
											<li key={evidence.code}>{evidence.reason}</li>
										))}
									</ul>
									<RecurringPatterns
										findings={related}
										names={names}
										readOnly={readOnly}
										label={`Repetition assessment for ${title}`}
									/>
									{finding.status === "withdrawn" && (
										<p>
											This pattern no longer applies. Answers are unavailable.
										</p>
									)}
									<ul
										className="my-2 space-y-1 pl-4"
										aria-label="Recorded payments"
									>
										{pattern.findings.map((item) => (
											<li key={item.id}>
												{names.get(item.transactionId) ?? item.provider} ·{" "}
												{paymentStatus(item)}
											</li>
										))}
									</ul>
									{!readOnly && (
										<Button
											type="button"
											size="sm"
											variant="secondary"
											disabled={busy}
											aria-label={`${finding.dismissed ? "Restore" : "Dismiss"} ${finding.kind} flag for ${title}`}
											onClick={() =>
												dismiss.mutate({
													id: finding.id,
													dismissed: !finding.dismissed,
												})
											}
										>
											{finding.dismissed ? "Restore" : "Dismiss"}
										</Button>
									)}
								</details>
							</TableHeader>
							<TableCell className="align-top">
								{summary.annualizedEstimate
									? paymentAmount(summary.annualizedEstimate, summary.currency)
									: "Not established"}
							</TableCell>
							<TableCell className="whitespace-normal align-top">
								{!readOnly && (
									<div className="flex flex-wrap gap-2">
										<Button
											type="button"
											size="sm"
											disabled={
												busy ||
												inactive ||
												finding.review?.decision === "confirmed"
											}
											aria-pressed={finding.review?.decision === "confirmed"}
											aria-label={`Confirm ${finding.kind} for ${title}`}
											onClick={() =>
												review.mutate(answerInput(finding, "confirm"))
											}
										>
											Confirm
										</Button>
										<Button
											type="button"
											size="sm"
											variant="secondary"
											disabled={
												busy ||
												inactive ||
												finding.review?.decision === "rejected"
											}
											aria-pressed={finding.review?.decision === "rejected"}
											aria-label={`Not ${finding.kind} for ${title}`}
											onClick={() =>
												review.mutate(answerInput(finding, "reject"))
											}
										>
											Not {finding.kind}
										</Button>
									</div>
								)}
							</TableCell>
						</TableRow>
					);
				})}
			</DataTable>
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
