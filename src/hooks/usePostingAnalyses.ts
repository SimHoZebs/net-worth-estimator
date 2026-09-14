import { useQuery } from "@tanstack/react-query";
import {
	type AnalysisResult,
	buildPostingObservationDataset,
	type ClassifiedPostingDataset,
	classifyPostings,
	type PostingObservationDataset,
	throwIfAborted,
	toAnalysisResult,
} from "@/lib/analysis";
import {
	detectPayroll,
	estimateSalary,
	type PayrollDetectionResult,
	type SalaryEstimateResult,
} from "@/lib/analysis/definitions";
import type { FinancialModelDocument } from "@/lib/projection";

const ANALYSIS_CACHE_TIME_MS = 5 * 60 * 1000;

export interface PostingAnalysisResults {
	classification: AnalysisResult<ClassifiedPostingDataset>;
	payroll: AnalysisResult<PayrollDetectionResult> | null;
	salary: AnalysisResult<SalaryEstimateResult> | null;
}

export function usePostingAnalyses(document: FinancialModelDocument | null) {
	const observationDataset: PostingObservationDataset | null = document
		? buildPostingObservationDataset(document)
		: null;
	return useQuery({
		queryKey: ["posting-analyses", observationDataset],
		queryFn: async ({ signal }): Promise<PostingAnalysisResults> => {
			throwIfAborted(signal);
			const classification = toAnalysisResult({
				value: classifyPostings(observationDataset!),
				diagnostics: [],
			});
			throwIfAborted(signal);
			if (classification.value === null) {
				return { classification, payroll: null, salary: null };
			}
			const payroll = toAnalysisResult(detectPayroll(classification.value));
			throwIfAborted(signal);
			if (payroll.value === null)
				return { classification, payroll, salary: null };
			const salary = toAnalysisResult(estimateSalary(payroll.value));
			throwIfAborted(signal);
			return { classification, payroll, salary };
		},
		enabled: observationDataset !== null,
		staleTime: Infinity,
		gcTime: ANALYSIS_CACHE_TIME_MS,
	});
}
