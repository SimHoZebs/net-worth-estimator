export interface AnalysisDiagnostic {
	code: string;
	severity: "info" | "warning" | "error";
	message: string;
}

export interface AnalysisValue<TOutput> {
	value: TOutput;
	diagnostics: AnalysisDiagnostic[];
}

export interface AnalysisDefinition<TInput, TOutput> {
	id: string;
	label: string;
	run(args: {
		input: TInput;
		signal?: AbortSignal;
	}): Promise<AnalysisValue<TOutput>> | AnalysisValue<TOutput>;
}

export type AnalysisResult<TOutput> =
	| {
			state: "ready" | "warning";
			value: TOutput;
			diagnostics: AnalysisDiagnostic[];
	  }
	| {
			state: "error";
			value: null;
			diagnostics: AnalysisDiagnostic[];
	  };
