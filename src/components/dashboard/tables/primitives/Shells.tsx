import { type ReactNode, useEffect, useRef, useState } from "react";
import { SectionCard } from "@/components/present/Present";
import { Button } from "@/components/ui/Button";

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
		<ConfirmButton
			label={label}
			onConfirm={onClick}
			idleLabel={children}
			confirmLabel="Confirm?"
			variant="ghost"
		/>
	);
}

/**
 * Two-step destructive button: the first tap arms ("Confirm?"), the second
 * confirms. Disarms after 5s. Keeps row deletion undo-safe on touch screens
 * where a single ✕ is too easy to hit.
 */
export function ConfirmButton({
	label,
	onConfirm,
	idleLabel,
	confirmLabel = "Confirm delete",
	variant = "destructive",
	className,
}: {
	label?: string;
	onConfirm: () => void;
	idleLabel: ReactNode;
	confirmLabel?: ReactNode;
	variant?: "ghost" | "destructive";
	className?: string;
}) {
	const [armed, setArmed] = useState(false);
	const timer = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
		},
		[],
	);
	return (
		<Button
			type="button"
			variant={variant}
			size="sm"
			className={className}
			aria-label={label}
			aria-pressed={armed}
			onClick={() => {
				if (!armed) {
					setArmed(true);
					if (timer.current !== null) window.clearTimeout(timer.current);
					timer.current = window.setTimeout(() => setArmed(false), 5000);
					return;
				}
				if (timer.current !== null) window.clearTimeout(timer.current);
				setArmed(false);
				onConfirm();
			}}
			onBlur={() => setArmed(false)}
		>
			{armed ? confirmLabel : idleLabel}
		</Button>
	);
}
