import type { ReactNode } from "react";
import { SectionCard } from "@/components/present/present";
import { Button } from "@/components/ui/button";

interface EditableTableCardProps {
	title: string;
	description: string;
	children: ReactNode;
	footer?: ReactNode;
}

/** Card + header shell shared by every editable grid. */
export function EditableTableCard({
	title,
	description,
	children,
	footer,
}: EditableTableCardProps) {
	return (
		<SectionCard
			title={title}
			description={description}
			className="rounded-[1.8rem] border-border shadow-sm"
		>
			{children}
			{footer ? <div className="mt-3">{footer}</div> : null}
		</SectionCard>
	);
}

interface AddRowButtonProps {
	onClick: () => void;
	children: ReactNode;
}

/** Ghost "add row" footer button shared by every editable grid. */
export function AddRowButton({ onClick, children }: AddRowButtonProps) {
	return (
		<Button type="button" variant="ghost" size="sm" onClick={onClick}>
			{children}
		</Button>
	);
}

interface RowDeleteButtonProps {
	label?: string;
	onClick: () => void;
	children?: ReactNode;
}

/** Ghost row-removal button. Defaults to the "✕" glyph used by most grids. */
export function RowDeleteButton({
	label,
	onClick,
	children = "✕",
}: RowDeleteButtonProps) {
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			onClick={onClick}
			aria-label={label}
		>
			{children}
		</Button>
	);
}
