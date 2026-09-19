// Thin re-export so the historical "@/hooks/useStochastic" module path (and
// its test mocks) keeps working. The implementation lives alongside
// useProjection in useProjection.ts, sharing one engine singleton, request
// identity, and stale mapping.
export { setProjectionEngine, useStochastic } from "./useProjection";
