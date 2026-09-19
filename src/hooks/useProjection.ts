// Historical module path; the implementation lives in "./useProjections"
// alongside useStochastic, sharing one engine singleton, request identity,
// and query-state core. Both this path and "@/hooks/useStochastic" are kept
// as re-exports because tests mock them.

export type { ProjectionHookState } from "./types";
export {
	setProjectionEngine,
	useProjection,
	useStochastic,
} from "./useProjections";
