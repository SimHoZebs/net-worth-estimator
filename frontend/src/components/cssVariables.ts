import type { CSSProperties } from "react";

/** Pass runtime values to CSS without allowing ordinary inline declarations. */
export function cssVariables(
	values: Record<`--${string}`, string | number | undefined>,
): CSSProperties {
	return values as CSSProperties;
}
