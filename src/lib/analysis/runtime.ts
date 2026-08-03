import type { AnalysisDefinition, AnalysisResult } from "./types";

function throwIfAborted(signal?: AbortSignal): void {
	if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
}

function isAbortError(error: unknown): boolean {
	return (
		(error instanceof DOMException && error.name === "AbortError") ||
		(error instanceof Error && error.name === "AbortError")
	);
}

export async function runAnalysis<TInput, TOutput>(
	definition: AnalysisDefinition<TInput, TOutput>,
	input: TInput,
	signal?: AbortSignal,
): Promise<AnalysisResult<TOutput>> {
	throwIfAborted(signal);
	try {
		const result = await definition.run({ input, signal });
		throwIfAborted(signal);
		const hasError = result.diagnostics.some(
			(diagnostic) => diagnostic.severity === "error",
		);
		const state = hasError
			? "error"
			: result.diagnostics.some(
						(diagnostic) => diagnostic.severity === "warning",
					)
				? "warning"
				: "ready";
		if (state === "error") {
			return { state, value: null, diagnostics: result.diagnostics };
		}
		return { state, ...result };
	} catch (error) {
		if (signal?.aborted) {
			throwIfAborted(signal);
		}
		if (isAbortError(error)) throw error;
		return {
			state: "error",
			value: null,
			diagnostics: [
				{
					code: "analysis.runtime.error",
					severity: "error",
					message: error instanceof Error ? error.message : String(error),
				},
			],
		};
	}
}
