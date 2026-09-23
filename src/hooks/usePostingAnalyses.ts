import { useMemo } from "react";
import {
	type AnalysisResult,
	buildPostingObservationDataset,
	type ClassifiedPostingDataset,
	classifyPostings,
	type PostingObservation,
	toAnalysisResult,
} from "@/lib/analysis";
import {
	detectPayroll,
	estimateSalary,
	type PayrollDetectionResult,
	type SalaryEstimateResult,
} from "@/lib/analysis/definitions";
import type { FinancialModelDocument } from "@/lib/projection";

export interface PostingAnalysisResults {
	classification: AnalysisResult<ClassifiedPostingDataset>;
	payroll: AnalysisResult<PayrollDetectionResult> | null;
	salary: AnalysisResult<SalaryEstimateResult> | null;
}

export interface PostingAnalyses {
	data: PostingAnalysisResults | null;
	observations: PostingObservation[];
	isLoading: boolean;
	isError: boolean;
}

// Pure synchronous pipeline over posting-derived observations: no query
// shell needed. Observations are exposed alongside the results so pages do
// not rebuild the dataset a second time. isLoading stays false because the
// pipeline is synchronous; isError reflects error-severity diagnostics.
// Pages add live regions for loading and errors.
export function usePostingAnalyses(
	document: FinancialModelDocument | null,
): PostingAnalyses {
	return useMemo<PostingAnalyses>(() => {
		if (!document) {
			return { data: null, observations: [], isLoading: false, isError: false };
		}
		const observationDataset = buildPostingObservationDataset(document);
		const observations = observationDataset.postings;
		const classification = toAnalysisResult({
			value: classifyPostings(observationDataset),
			diagnostics: [],
		});
		if (classification.state === "error") {
			return {
				data: { classification, payroll: null, salary: null },
				observations,
				isLoading: false,
				isError: true,
			};
		}
		const payroll = toAnalysisResult(detectPayroll(classification.value));
		if (payroll.state === "error") {
			return {
				data: { classification, payroll, salary: null },
				observations,
				isLoading: false,
				isError: true,
			};
		}
		const salary = toAnalysisResult(estimateSalary(payroll.value));
		return {
			data: { classification, payroll, salary },
			observations,
			isLoading: false,
			isError: salary.state === "error",
		};
	}, [document]);
}
