import type { VariantProps } from "class-variance-authority";
import { progressStyles } from "./progressStyles.ts";

/** A determinate bar. The native element owns the progressbar role and value
 * semantics, so no ARIA range attributes or width variables are needed. */
export function Progress({
	value,
	label,
	tone = "success",
}: {
	value: number;
	label: string;
} & VariantProps<typeof progressStyles>) {
	return (
		<progress
			className={progressStyles({ tone })}
			aria-label={label}
			value={Math.min(100, Math.max(0, Math.round(value)))}
			max={100}
		/>
	);
}
