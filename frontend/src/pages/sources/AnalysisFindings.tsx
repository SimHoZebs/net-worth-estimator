import { useState } from "react";
import {
	findingLabel,
	findingStatus,
	providerLabel,
} from "@/domain/analysisFindings.ts";
import {
	useAnalyses,
	useAnalysisFindings,
	useDismissAnalysisFinding,
} from "@/state/analyses.ts";
import { useTransactionCatalog } from "@/state/workspaceResources.ts";
import { useUserReadOnly } from "@/state/useUserScope.ts";
import { useAllAnalysisFindings } from "@/state/allAnalysisFindings.ts";
import { Badge } from "@/components/Badge.tsx";
import { Button } from "@/components/Button.tsx";
import { PaymentFindings } from "@/components/analysis/PaymentFindings.tsx";
import { RecurringPatterns } from "@/components/analysis/RecurringPatterns.tsx";
import {
	DataTable,
	TableCell,
	TableHeader,
	TableRow,
} from "@/components/DataTable.tsx";
import { ErrorNotice } from "@/components/ErrorNotice.tsx";

export function AnalysisFindings() {
	const [cursors, setCursors] = useState([""]);
	const query = useAnalysisFindings(undefined, cursors.at(-1) ?? "");
	const complete = useAllAnalysisFindings();
	const analyses = useAnalyses();
	const review = useDismissAnalysisFinding();
	const catalog = useTransactionCatalog().data;
	const readOnly = useUserReadOnly();
	const transactions = (catalog?.items ?? []).map((item) => ({
		id: item.id,
		name: item.name,
	}));
	const allFindings = query.data?.findings ?? [];
	const findings = allFindings.filter((finding) => finding.kind === "bnpl");
	const recurring = allFindings.filter(
		(finding) => finding.kind === "recurring",
	);
	const payments = (complete.data ?? []).filter((finding) => !!finding.pattern);
	const names = new Map(
		transactions.map((transaction) => [transaction.id, transaction.name]),
	);
	const state = analyses.data?.analyses?.find(
		(item) => item.type === "bnpl",
	)?.state;
	return (
		<>
			<section className="space-y-4">
				{findings.length > 0 && (
					<h2 className="m-0 text-lg font-semibold">Buy now, pay later</h2>
				)}
				{(state === "queued" || state === "running") && (
					<p className="text-xs text-muted">
						Analysis is pending. Previous findings can appear as awaiting
						analysis.
					</p>
				)}
				<ErrorNotice
					message={
						review.isError
							? "The finding could not be updated. Try again."
							: query.isError || analyses.isError
								? "Analysis results could not be loaded."
								: state === "failed"
									? "Analysis could not finish. The background worker will retry. Account sync is unaffected."
									: null
					}
				/>
				{query.isPending ? (
					<p className="text-sm text-muted">Loading findings…</p>
				) : findings.length ? (
					<DataTable
						caption="Detected transaction findings"
						showHeaders
						columns={[
							{ label: "Transaction and evidence" },
							{ label: "Finding" },
							{ label: "Status" },
							{ label: "Review" },
						]}
					>
						{findings.map((finding) => (
							<TableRow key={finding.id}>
								<TableHeader scope="row">
									<span className="text-sm font-semibold">
										{names.get(finding.transactionId) ?? "Saved transaction"}
									</span>
									<p className="mb-0 mt-1 text-xs text-muted">
										{providerLabel(finding.provider)} · {finding.role}
									</p>
									<ul className="mb-0 mt-2 space-y-1 pl-4 text-xs font-normal text-muted">
										{finding.evidence?.map((evidence) => (
											<li key={evidence.code}>{evidence.reason}</li>
										))}
									</ul>
								</TableHeader>
								<TableCell>
									<Badge tone="neutral">{findingLabel(finding)}</Badge>
								</TableCell>
								<TableCell>{findingStatus(finding)}</TableCell>
								<TableCell>
									{!readOnly && (
										<Button
											type="button"
											variant="secondary"
											size="sm"
											aria-label={`${finding.dismissed ? "Restore" : "Dismiss"} flag for ${names.get(finding.transactionId) ?? finding.transactionId}`}
											disabled={review.isPending}
											onClick={() =>
												review.mutate({
													id: finding.id,
													dismissed: !finding.dismissed,
												})
											}
										>
											{finding.dismissed ? "Restore" : "Dismiss"}
										</Button>
									)}
								</TableCell>
							</TableRow>
						))}
					</DataTable>
				) : allFindings.length === 0 ? (
					<p className="text-sm text-muted">No findings yet.</p>
				) : null}
				{(cursors.length > 1 || query.data?.nextCursor) && (
					<div className="flex gap-2">
						<Button
							type="button"
							variant="secondary"
							size="sm"
							disabled={cursors.length === 1}
							onClick={() => setCursors((previous) => previous.slice(0, -1))}
						>
							Previous findings
						</Button>
						<Button
							type="button"
							variant="secondary"
							size="sm"
							disabled={!query.data?.nextCursor}
							onClick={() => {
								const next = query.data?.nextCursor;
								if (next) setCursors((previous) => [...previous, next]);
							}}
						>
							Next findings
						</Button>
					</div>
				)}
			</section>
			{complete.isError ? (
				<ErrorNotice message="Payment findings could not be loaded completely. Try again." />
			) : complete.isPending ? (
				<p className="text-sm text-muted">Loading payment findings…</p>
			) : (
				<PaymentFindings
					findings={payments}
					names={names}
					readOnly={readOnly}
				/>
			)}
			<RecurringPatterns
				findings={recurring}
				names={names}
				readOnly={readOnly}
			/>
		</>
	);
}
