import { cn } from "../lib/utils.ts";

/**
 * Deprecated alias of `cn`. The extended merger in lib/utils.ts knows the
 * same semantic scale this file used to configure, so both names share one
 * engine. New code imports `cn`; delete this file once its importers follow.
 */
export const mergeStyles = cn;
