import { createContext, useContext, type ReactNode } from "react";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { activeBNPLFinding } from "@/domain/analysisFindings.ts";
import { useAnalysisFindings } from "@/state/analyses.ts";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { BNPLConfirmation } from "./BNPLConfirmation.tsx";

export const AnalysisFindingsContext = createContext<AnalysisFinding[]>([]);

/** One batch request per visible transaction page, never one request per row. */
export function TransactionAnalysisProvider({
	transactionIds,
	children,
}: {
	transactionIds: string[];
	children: ReactNode;
}) {
	const findings = useAnalysisFindings(transactionIds);
	return (
		<AnalysisFindingsContext value={findings.data?.findings ?? []}>
			{children}
		</AnalysisFindingsContext>
	);
}

export function useTransactionBNPL(transactionId: string) {
	return activeBNPLFinding(useContext(AnalysisFindingsContext), transactionId);
}

export function TransactionAnalysisPanel({
	transactionId,
	readOnly,
}: {
	transactionId: string;
	readOnly: boolean;
}) {
	const query = useAnalysisFindings([transactionId]);
	const findings = (query.data?.findings ?? []).filter((item) =>
		activeBNPLFinding([item], transactionId),
	);
	// Quiet detection: pending questions live in the suggestions sheet.
	// The detail body shows only completed facts (a confirmed plan with its
	// length), so the sheet stays the single place that collects a length.
	// Read-only viewers keep the compact badge line so findings stay
	// inspectable without actions.
	const visible = readOnly
		? findings
		: findings.filter(
				(item) =>
					item.review?.decision === "confirmed" && item.review?.duration,
			);
	if (!visible.length && !query.isError) return null;
	return (
		<section
			className="mt-4 border-t border-line pt-4"
			aria-label="Transaction analysis"
		>
			<ErrorNotice reserve message={query.isError ? "Transaction findings could not be loaded." : null} />
			{visible.map((finding) => (
				<BNPLConfirmation
					key={finding.id}
					finding={finding}
					readOnly={readOnly}
				/>
			))}
		</section>
	);
}
