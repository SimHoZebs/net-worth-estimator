import { mergeStyles } from "./mergeStyles.ts";

export function Skeleton({
	className,
	label = "Loading",
}: {
	className?: string;
	label?: string;
}) {
	return (
		<span
			className={mergeStyles(
				"block h-4 w-full max-w-full animate-[skeleton-pulse_1.2s_ease-in-out_infinite] rounded-control bg-line-strong opacity-55",
				className,
			)}
			role="status"
			aria-label={label}
			aria-busy="true"
		/>
	);
}
