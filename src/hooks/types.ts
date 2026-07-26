export interface ProjectionHookState<TResult> {
	result: TResult | null;
	runtimeError: string | null;
	isRunning: boolean;
	progress: number | null;
	resultIsStale: boolean;
}
