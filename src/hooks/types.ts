export interface ProjectionHookState<TResult, TProgress = number> {
	result: TResult | null;
	runtimeError: string | null;
	isRunning: boolean;
	progress: TProgress | null;
	resultIsStale: boolean;
}
