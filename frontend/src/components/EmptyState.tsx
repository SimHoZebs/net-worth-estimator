import type { LucideIcon } from "lucide-react";
import { Button } from "./Button.tsx";
import { mergeStyles } from "./mergeStyles.ts";
import {
	Empty as ShadcnEmpty,
	EmptyContent as ShadcnEmptyContent,
	EmptyDescription as ShadcnEmptyDescription,
	EmptyHeader as ShadcnEmptyHeader,
	EmptyMedia as ShadcnEmptyMedia,
} from "./ui/empty.tsx";

/**
 * Empty state on shadcn empty parts. The legacy recipe stays the visual
 * owner (dark-mode-safe application tokens, lucide icon, heading level);
 * gap-0, flex-initial, and font-sans neutralize the primitive's wider
 * spacing, growing layout, and display typeface.
 */
export function EmptyState({
	icon: Icon,
	title,
	description,
	action,
	onAction,
}: {
	icon: LucideIcon;
	title: string;
	description?: string;
	action?: string;
	onAction?: () => void;
}) {
	return (
		<ShadcnEmpty
			className={mergeStyles(
				"flex w-full min-w-0 flex-initial flex-col items-center gap-0 px-6 py-12 text-center",
			)}
		>
			<ShadcnEmptyHeader>
				<ShadcnEmptyMedia>
					<span className="mb-5 grid size-16 place-items-center rounded-full bg-success-bg text-success-text">
						<Icon size={28} />
					</span>
				</ShadcnEmptyMedia>
				<h3 className="text-lg">{title}</h3>
				{description && (
					<ShadcnEmptyDescription className="mt-2 mb-5 max-w-sm text-muted">
						{description}
					</ShadcnEmptyDescription>
				)}
			</ShadcnEmptyHeader>
			{action && (
				<ShadcnEmptyContent>
					<Button variant="primary" onClick={onAction}>
						{action}
					</Button>
				</ShadcnEmptyContent>
			)}
		</ShadcnEmpty>
	);
}
