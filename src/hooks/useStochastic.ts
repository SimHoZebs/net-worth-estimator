// Historical module path (and its test mocks) keeps working. The
// implementation lives alongside useProjection in "./useProjections",
// sharing one engine singleton, request identity, and query-state core.

export type { ProjectionHookState } from "./types";
export {
	setProjectionEngine,
	useProjection,
	useStochastic,
} from "./useProjections";
