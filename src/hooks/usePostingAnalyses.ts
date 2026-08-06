import { useQuery } from "@tanstack/react-query";
import {
	type AnalysisResult,
	buildPostingObservationDataset,
	type ClassifiedPostingDataset,
	createPostingClassificationAnalysis,
	createPostingClassificationPlan,
	type PostingObservationDataset,
	runAnalysis,
} from "@/lib/analysis";
import {
	type PayrollDetectionResult,
	payrollDetectionAnalysis,
	type SalaryEstimateResult,
	salaryEstimateAnalysis,
} from "@/lib/analysis/definitions";
import type { FinancialModelDocument } from "@/lib/projection";

const ANALYSIS_CACHE_TIME_MS = 5 * 60 * 1000;
const postingClassificationAnalysis = createPostingClassificationAnalysis(
	createPostingClassificationPlan(
		payrollDetectionAnalysis.classificationRequirements,
	),
);

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
			const classification = await runAnalysis(
				postingClassificationAnalysis,
				observationDataset!,
				signal,
			);
			if (classification.value === null) {
				return { classification, payroll: null, salary: null };
			}
			const payroll = await runAnalysis(
				payrollDetectionAnalysis,
				classification.value,
				signal,
			);
			if (payroll.value === null)
				return { classification, payroll, salary: null };
			const salary = await runAnalysis(
				salaryEstimateAnalysis,
				payroll.value,
				signal,
			);
			return { classification, payroll, salary };
		},
		enabled: observationDataset !== null,
		staleTime: Infinity,
		gcTime: ANALYSIS_CACHE_TIME_MS,
	});
}
