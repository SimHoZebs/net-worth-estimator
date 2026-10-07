export interface AnalysisDiagnostic {
	code: string;
	severity: "info" | "warning" | "error";
	message: string;
}

export interface AnalysisValue<TOutput> {
	value: TOutput;
	diagnostics: AnalysisDiagnostic[];
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
