import type { LucideIcon } from "lucide-react";
import { Button } from "./Button.tsx";

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
		<div className="flex flex-col items-center px-6 py-12 text-center">
			<span className="mb-5 grid size-16 place-items-center rounded-full bg-success-bg text-success-text">
				<Icon size={28} />
			</span>
			<h3 className="text-lg">{title}</h3>
			{description && (
				<p className="mt-2 mb-5 max-w-sm text-sm">{description}</p>
			)}
			{action && (
				<Button variant="primary" onClick={onAction}>
					{action}
				</Button>
			)}
		</div>
	);
}
