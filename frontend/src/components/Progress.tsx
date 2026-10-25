import type { VariantProps } from "class-variance-authority";
import { cssVariables } from "./cssVariables.ts";
import { progressFillStyles, progressTrackStyles } from "./progressStyles.ts";

export function Progress({
	value,
	label,
	tone = "success",
}: {
	value: number;
	label: string;
} & VariantProps<typeof progressTrackStyles>) {
	return (
		<div
			className={progressTrackStyles({ tone })}
			role="progressbar"
			aria-label={label}
			aria-valuenow={Math.round(Math.min(100, Math.max(0, value)))}
			aria-valuemin={0}
			aria-valuemax={100}
		>
			<span
				className={progressFillStyles({ tone })}
				style={cssVariables({
					"--progress-width": `${Math.min(100, Math.max(0, value))}%`,
				})}
			/>
		</div>
	);
}
