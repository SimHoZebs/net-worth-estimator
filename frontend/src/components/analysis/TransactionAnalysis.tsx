import { createContext, useContext, type ReactNode } from "react";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { activeBNPLFinding } from "@/domain/analysisFindings.ts";
import { useAnalysisFindings } from "@/state/analyses.ts";
import { ErrorNotice } from "../ErrorNotice.tsx";
import { BNPLConfirmation } from "./BNPLConfirmation.tsx";

export const AnalysisFindingsContext = createContext<AnalysisFinding[]>([]);

/** One batch request per visible transaction page, never one request per row. */
export function TransactionAnalysisProvider({
	postingIds,
	children,
}: {
	postingIds: string[];
	children: ReactNode;
}) {
	const findings = useAnalysisFindings(postingIds);
	return (
		<AnalysisFindingsContext value={findings.data?.findings ?? []}>
			{children}
		</AnalysisFindingsContext>
	);
}

export function useTransactionBNPL(postingId: string) {
	return activeBNPLFinding(useContext(AnalysisFindingsContext), postingId);
}

export function TransactionAnalysisPanel({
	postingId,
	readOnly,
}: {
	postingId: string;
	readOnly: boolean;
}) {
	const query = useAnalysisFindings([postingId]);
	const findings = (query.data?.findings ?? []).filter((item) =>
		activeBNPLFinding([item], postingId),
	);
	if (!findings.length && !query.isError) return null;
	return (
		<section
			className="mt-4 border-t border-line pt-4"
			aria-label="Transaction analysis"
		>
			{query.isError && (
				<ErrorNotice message="Transaction findings could not be loaded." />
			)}
			{findings.map((finding) => (
				<BNPLConfirmation
					key={finding.id}
					finding={finding}
					readOnly={readOnly}
				/>
			))}
		</section>
	);
}
