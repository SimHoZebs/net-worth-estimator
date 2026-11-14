export { cn } from "cn";

// Companion to mergeStyles in ../components/mergeStyles.ts, which remains the
// application merger: it knows the semantic radius (control, surface) and
// shadow (overlay) scale that the default `cn` build does not. Unify them in
// Phase 2 once primitive swaps land.
