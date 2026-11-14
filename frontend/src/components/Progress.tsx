import { cn } from "@/lib/utils.ts";

const progressTones = {
	success:
		"bg-line [&::-webkit-progress-bar]:bg-line [&::-webkit-progress-value]:rounded-[inherit] [&::-webkit-progress-value]:bg-primary [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-350 [&::-moz-progress-bar]:rounded-[inherit] [&::-moz-progress-bar]:bg-primary",
	warning:
		"bg-warning-bg [&::-webkit-progress-bar]:bg-warning-bg [&::-webkit-progress-value]:rounded-[inherit] [&::-webkit-progress-value]:bg-warning-text [&::-webkit-progress-value]:transition-[width] [&::-webkit-progress-value]:duration-350 [&::-moz-progress-bar]:rounded-[inherit] [&::-moz-progress-bar]:bg-warning-text",
} as const;

export type ProgressTone = keyof typeof progressTones;

/**
 * A determinate bar. The native element owns the progressbar role and value
 * semantics (including the reflected value attribute callers assert on), so
 * no ARIA range attributes or width variables are needed. Tone only
 * recolors the track and fill.
 */
export function Progress({
	value,
	label,
	tone = "success",
}: {
	value: number;
	label: string;
	tone?: ProgressTone;
}) {
	return (
		<progress
			className={cn(
				"block h-1 w-full appearance-none overflow-hidden rounded-control",
				progressTones[tone],
			)}
			aria-label={label}
			value={Math.min(100, Math.max(0, Math.round(value)))}
			max={100}
		/>
	);
}
