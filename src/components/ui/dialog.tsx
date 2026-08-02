import {
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useLayoutEffect,
	useRef,
} from "react";
import { cn } from "@/lib/utils";

interface DialogProps {
	children: ReactNode;
	onClose: () => void;
	ariaLabel?: string;
	ariaLabelledby?: string;
	ariaDescribedby?: string;
	role?: "dialog" | "alertdialog";
	className?: string;
}

function focusableElements(dialog: HTMLElement): HTMLElement[] {
	return Array.from(
		dialog.querySelectorAll<HTMLElement>(
			"button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
		),
	);
}

export function Dialog({
	children,
	onClose,
	ariaLabel,
	ariaLabelledby,
	ariaDescribedby,
	role = "dialog",
	className,
}: DialogProps) {
	const dialogRef = useRef<HTMLDivElement>(null);
	const previousFocusRef = useRef<HTMLElement | null>(null);

	useLayoutEffect(() => {
		previousFocusRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		const dialog = dialogRef.current;
		const first = dialog ? focusableElements(dialog)[0] : undefined;
		(first ?? dialog)?.focus();
		return () => {
			requestAnimationFrame(() => previousFocusRef.current?.focus());
		};
	}, []);

	const handleKeyDown = useCallback(
		(event: KeyboardEvent<HTMLDivElement>) => {
			if (event.key === "Escape") {
				event.preventDefault();
				onClose();
				return;
			}
			if (event.key !== "Tab" || !dialogRef.current) return;
			const controls = focusableElements(dialogRef.current);
			const first = controls[0];
			const last = controls[controls.length - 1];
			if (!first || !last) return;
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last.focus();
			} else if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first.focus();
			}
		},
		[onClose],
	);

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-4 backdrop-blur-sm"
			role="presentation"
			onMouseDown={(event) => {
				if (event.target === event.currentTarget) onClose();
			}}
		>
			{/* biome-ignore lint/a11y/useAriaPropsSupportedByRole: role is constrained to dialog or alertdialog by the component API. */}
			<div
				ref={dialogRef}
				role={role}
				aria-modal="true"
				aria-label={ariaLabel}
				aria-labelledby={ariaLabelledby}
				aria-describedby={ariaDescribedby}
				tabIndex={-1}
				onKeyDown={handleKeyDown}
				className={cn("max-h-[90vh] w-full overflow-y-auto", className)}
			>
				{children}
			</div>
		</div>
	);
}
