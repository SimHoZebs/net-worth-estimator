import type { AnalysisFinding } from "../../api/generated/model/analysisFinding.ts";
import { useAnalysisFindings } from "../../state/analyses.ts";

/** Read-only transfer-pair annotation (VIS-03 consumer). The VIS-03
 * `Transfer` analyzer (backend/internal/analysis/transfer.go) publishes one
 * detection per observed leg with kind "transfer": strength "strong" for an
 * exactly-one mutual opposite-leg pair, "moderate" with every candidate
 * listed when several match. Transfer edges are counted once in transfer
 * totals — never as income plus spending — and this note shows what the
 * matcher observed about the opposite leg. Review actions stay out:
 * ambiguous-match review UX is VIS-03's open decision. */
export function transferFindingsForEdge(
	findings: AnalysisFinding[],
	postingIds: string[],
): AnalysisFinding[] {
	if (!postingIds.length) return [];
	const ids = new Set(postingIds);
	return findings.filter(
		(finding) =>
			finding.kind === "transfer" &&
			!finding.dismissed &&
			finding.review?.decision !== "rejected" &&
			ids.has(finding.postingId),
	);
}

export function TransferMatchNote({
	postingIds,
	transferCount,
}: {
	postingIds: string[];
	/** Number of source transactions behind the edge. */
	transferCount: number;
}) {
	const query = useAnalysisFindings(postingIds);
	const findings = transferFindingsForEdge(
		query.data?.findings ?? [],
		postingIds,
	);
	const matched = findings.filter((finding) => finding.strength === "strong");
	const ambiguous = findings.filter((finding) => finding.strength !== "strong");
	return (
		<div className="mt-3 border-t border-line pt-3">
			<p className="text-xs text-muted">
				Counted once as a transfer
				{transferCount > 1 ? ` across ${transferCount} transactions` : ""}, not
				as income plus spending.
			</p>
			{query.isError ? (
				<p className="mt-1 text-xs text-muted">
					Transfer-pair information could not be loaded.
				</p>
			) : matched.length > 0 ? (
				<p className="mt-1 text-xs text-success-text">
					Both sides of this transfer are observed.
				</p>
			) : ambiguous.length > 0 ? (
				<p className="mt-1 text-xs text-warning-text">
					Several possible matching transfers were found; the true opposite side
					is not settled yet.
				</p>
			) : (
				<p className="mt-1 text-xs text-muted">
					No matching opposite transfer is confirmed yet.
				</p>
			)}
		</div>
	);
}
