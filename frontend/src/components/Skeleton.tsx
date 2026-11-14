import { mergeStyles } from "./mergeStyles.ts";

/**
 * Loading placeholder with the legacy recipe as the visual owner
 * (dark-mode-safe application tokens, status announcement). It renders a
 * span (not the shadcn div primitive) so it stays valid phrasing content
 * inside p elements such as the evaluation card outcome line.
 */
export function Skeleton({
	className,
	label = "Loading",
}: {
	className?: string;
	label?: string;
}) {
	return (
		<span
			data-slot="skeleton"
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
