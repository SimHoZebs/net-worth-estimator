import { useState } from "react";
import { AlertCircle } from "lucide-react";
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
import { Badge } from "@/components/ui/badge.tsx";
import { Button } from "@/components/ui/button.tsx";
import { PatternReview } from "@/components/analysis/PatternReview.tsx";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { dismissKey, notifyError } from "@/state/notifications.ts";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table.tsx";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";

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
	const patterns = (complete.data ?? []).filter(
		(finding) => finding.pattern || finding.kind === "recurring",
	);
	const names = new Map(
		transactions.map((transaction) => [transaction.id, transaction.name]),
	);
	const state = analyses.data?.analyses?.find(
		(item) => item.type === "bnpl",
	)?.state;
	const findingsError =
		query.isError || analyses.isError
			? "Analysis results could not be loaded."
			: state === "failed"
				? "Analysis could not finish. The background worker will retry. Account sync is unaffected."
				: null;
	return (
		<>
			<section className="space-y-4">
				{findings.length > 0 && (
					<h2 className="m-0 text-lg font-semibold">Buy now, pay later</h2>
				)}
				{(state === "queued" || state === "running") && (
					<p className="text-xs text-muted-foreground">
						Analysis is pending. Previous findings can appear as awaiting
						analysis.
					</p>
				)}
				{findingsError ? (
					<Alert variant="destructive">
						<AlertCircle size={16} aria-hidden="true" />
						<AlertDescription>{findingsError}</AlertDescription>
					</Alert>
				) : null}
				{query.isPending ? (
					<p className="text-sm text-muted-foreground">Loading findings…</p>
				) : findings.length ? (
					<Table
						className="w-full border-collapse text-left text-sm"
						containerClassName="max-w-full"
						containerProps={{
							role: "region",
							"aria-label": "Detected transaction findings",
						}}
					>
						<TableCaption className="sr-only">
							Detected transaction findings
						</TableCaption>
						<TableHeader>
							<TableRow>
								<TableHead>Transaction and evidence</TableHead>
								<TableHead>Finding</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Review</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{findings.map((finding) => (
								<TableRow key={finding.id}>
									<TableHead scope="row">
										<span className="text-sm font-semibold">
											{names.get(finding.transactionId) ?? "Saved transaction"}
										</span>
										<p className="mb-0 mt-1 text-xs text-muted-foreground">
											{providerLabel(finding.provider)} · {finding.role}
										</p>
										<ul className="mb-0 mt-2 space-y-1 pl-4 text-xs font-normal text-muted-foreground">
											{finding.evidence?.map((evidence) => (
												<li key={evidence.code}>{evidence.reason}</li>
											))}
										</ul>
									</TableHead>
									<TableCell>
										<Badge variant="secondary">{findingLabel(finding)}</Badge>
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
													review.mutate(
														{
															id: finding.id,
															dismissed: !finding.dismissed,
														},
														{
															// Failures reach the toast from here. The panel never
															// mirrors them inline so one event keeps one place to find.
															// Retired scopes stay silent.
															onError: (error) => {
																if (error instanceof UserScopeError) return;
																const message =
																	error instanceof Error
																		? error.message
																		: "The finding could not be updated. Try again.";
																notifyError("analysis-review", message);
															},
															onSuccess: () => dismissKey("analysis-review"),
														},
													)
												}
											>
												{finding.dismissed ? "Restore" : "Dismiss"}
											</Button>
										)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				) : allFindings.length === 0 ? (
					<p className="text-sm text-muted-foreground">No findings yet.</p>
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
				<Alert variant="destructive">
					<AlertCircle size={16} aria-hidden="true" />
					<AlertDescription>
						Payment findings could not be loaded completely. Try again.
					</AlertDescription>
				</Alert>
			) : complete.isPending ? (
				<p className="text-sm text-muted-foreground">
					Loading payment findings…
				</p>
			) : (
				<PatternReview findings={patterns} names={names} readOnly={readOnly} />
			)}
		</>
	);
}
