import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";

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
		<Card className="rounded-[1.8rem] border-border shadow-sm">
			<CardHeader>
				<CardTitle>{title}</CardTitle>
				<CardDescription>{description}</CardDescription>
			</CardHeader>
			<CardContent>
				{children}
				{footer ? <div className="mt-3">{footer}</div> : null}
			</CardContent>
		</Card>
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
