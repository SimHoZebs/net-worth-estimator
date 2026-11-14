import { mergeStyles } from "./mergeStyles.ts";
import { Skeleton as ShadcnSkeleton } from "./ui/skeleton.tsx";

/**
 * Loading placeholder on the shadcn skeleton primitive. The legacy recipe
 * stays the visual owner (dark-mode-safe application tokens, status
 * announcement); the primitive contributes the data slot.
 */
export function Skeleton({
	className,
	label = "Loading",
}: {
	className?: string;
	label?: string;
}) {
	return (
		<ShadcnSkeleton
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
