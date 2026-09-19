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
	isLoading: false;
	isError: false;
}

// Pure synchronous pipeline over posting-derived observations: no query
// shell needed. Observations are exposed alongside the results so pages do
// not rebuild the dataset a second time.
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
		if (classification.value === null) {
			return {
				data: { classification, payroll: null, salary: null },
				observations,
				isLoading: false,
				isError: false,
			};
		}
		const payroll = toAnalysisResult(detectPayroll(classification.value));
		if (payroll.value === null) {
			return {
				data: { classification, payroll, salary: null },
				observations,
				isLoading: false,
				isError: false,
			};
		}
		const salary = toAnalysisResult(estimateSalary(payroll.value));
		return {
			data: { classification, payroll, salary },
			observations,
			isLoading: false,
			isError: false,
		};
	}, [document]);
}
