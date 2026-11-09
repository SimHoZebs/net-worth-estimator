import { useState } from "react";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	groupIncomePatterns,
	incomeAmount,
	incomeLabel,
	incomeStatus,
} from "@/domain/incomeFindings.ts";
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

export function IncomeFindings({
	findings,
	names,
	readOnly,
}: {
	findings: AnalysisFinding[];
	names: Map<string, string>;
	readOnly: boolean;
}) {
	const review = useReviewAnalysisFinding();
	const dismiss = useDismissAnalysisFinding();
	const [rows, setRows] = useState(5);
	const patterns = groupIncomePatterns(findings);
	if (!patterns.length) return null;
	const busy = review.isPending || dismiss.isPending;
	return (
		<section className="space-y-3" aria-label="Income">
			<header className="space-y-1">
				<h2 className="m-0 text-lg font-semibold">Income</h2>
				<p className="m-0 text-sm text-muted">
					Confirm or correct suggested income.
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
				caption="Detected income patterns"
				showHeaders
				columns={[
					{ label: "Income" },
					{ label: "Annual estimate" },
					{ label: "Review" },
				]}
			>
				{patterns.slice(0, rows).map((pattern) => {
					const finding = pattern.anchor;
					const summary = finding.income!;
					const title = names.get(finding.transactionId) ?? finding.provider;
					const inactive = finding.stale || finding.status === "withdrawn";
					const status =
						inactive || finding.dismissed
							? incomeStatus(finding)
							: incomeLabel(finding);
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
								</div>
								<p className="mb-0 mt-1 text-xs text-muted">
									{incomeAmount(summary.typicalAmount, summary.currency)} ·{" "}
									{cadenceLabel(finding.product)} · {depositCount}{" "}
									{depositCount === 1 ? "deposit" : "deposits"}
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
									{finding.status === "withdrawn" && (
										<p>
											This pattern no longer applies. Answers are unavailable.
										</p>
									)}
									<ul
										className="my-2 space-y-1 pl-4"
										aria-label="Recorded deposits"
									>
										{pattern.findings.map((item) => (
											<li key={item.id}>
												{names.get(item.transactionId) ?? item.provider} ·{" "}
												{incomeStatus(item)}
											</li>
										))}
									</ul>
									{!readOnly && (
										<Button
											type="button"
											size="sm"
											variant="secondary"
											disabled={busy}
											aria-label={`${finding.dismissed ? "Restore" : "Dismiss"} income flag for ${title}`}
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
								{incomeAmount(summary.annualizedEstimate, summary.currency)}
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
											aria-label={`Confirm income for ${title}`}
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
											aria-label={`Not income for ${title}`}
											onClick={() =>
												review.mutate(answerInput(finding, "reject"))
											}
										>
											Not income
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
					Show more income
				</Button>
			)}
		</section>
	);
}
