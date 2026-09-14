import type { AnalysisResult, AnalysisValue } from "./types";

export function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

export function toAnalysisResult<TOutput>(
	result: AnalysisValue<TOutput>,
): AnalysisResult<TOutput> {
	const hasError = result.diagnostics.some(
		(diagnostic) => diagnostic.severity === "error",
	);
	if (hasError) {
		return { state: "error", value: null, diagnostics: result.diagnostics };
	}
	if (
		result.diagnostics.some((diagnostic) => diagnostic.severity === "warning")
	) {
		return { state: "warning", ...result };
	}
	return { state: "ready", ...result };
}
