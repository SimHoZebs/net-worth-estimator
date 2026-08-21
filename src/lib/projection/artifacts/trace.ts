export function projectionCacheErrorDetails(error: unknown) {
	return {
		errorName: error instanceof Error ? error.name : typeof error,
	};
}

export function traceProjectionCache(
	event: string,
	details: Record<string, unknown> = {},
): void {
	if (typeof window === "undefined") return;
	try {
		console.log(`[projection-cache] ${event}`, details);
	} catch {
		// Diagnostics must never affect projection execution.
	}
}
