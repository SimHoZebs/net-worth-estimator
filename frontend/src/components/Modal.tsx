import { X } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { IconButton } from "./Button.tsx";
import { useOpenModalRegistration } from "./modalStack.ts";
import { dialogBodyStyles, dialogHeaderStyles } from "./dialogStyles.ts";
import { mergeStyles } from "./mergeStyles.ts";

export function Modal({
	title,
	eyebrow,
	children,
	onClose,
	onCloseRequest,
	wide = false,
	className = "",
	headerClassName,
	bodyClassName,
	titleSize = "display",
	actions,
	focusPanelOnOpen = false,
}: {
	title: ReactNode;
	eyebrow?: string;
	children: ReactNode;
	onClose: () => void;
	/** Return false to keep the dialog visible, such as for unsaved-form confirmation. */
	onCloseRequest?: () => boolean;
	wide?: boolean;
	className?: string;
	headerClassName?: string;
	bodyClassName?: string;
	/** Plain titles name the subject without competing with the content. */
	titleSize?: "display" | "plain";
	/** Extra icon buttons beside the corner close button. */
	actions?: ReactNode;
	/**
	 * Focus the panel itself on open instead of the browser default (first
	 * focusable control). For dialogs whose first control is a value that
	 * looks like text, an initial focus ring reads as a rendering bug.
	 */
	focusPanelOnOpen?: boolean;
}) {
	const ref = useRef<HTMLDialogElement>(null);
	const panelRef = useRef<HTMLDivElement>(null);
	// Mounted means open for this component: showModal runs on mount.
	useOpenModalRegistration(true);
	const [closing, setClosing] = useState(false);
	const closeRequested = useRef(false);
	const reduceMotion = useReducedMotion();
	const id = useId();
	useEffect(() => {
		const dialog = ref.current;
		const previous = document.activeElement;
		dialog?.showModal();
		if (focusPanelOnOpen) panelRef.current?.focus();
		return () => {
			dialog?.close();
			if (previous instanceof HTMLElement && previous.isConnected)
				previous.focus();
		};
		// oxlint-disable-next-line react/exhaustive-deps
	}, []);
	const requestClose = () => {
		if (closeRequested.current) return;
		if (onCloseRequest?.() === false) return;
		closeRequested.current = true;
		setClosing(true);
	};
	// Centered dialogs scale/fade. Drawer sheets are the shared Drawer
	// component; the native <dialog> stays static so showModal top-layer,
	// focus, and backdrop behavior are unchanged — motion owns only the
	// inner panel.
	const enter = { opacity: 1, scale: 1, y: 0 };
	const initial = { opacity: 0, scale: 0.97, y: 8 };
	const exit = { opacity: 0, scale: 0.98, y: 8 };
	return (
		<dialog
			ref={ref}
			className={mergeStyles(
				"max-h-[90dvh] w-full max-w-[calc(100%_-_--spacing(6))] rounded-surface border border-solid border-line-strong bg-surface p-0 text-ink shadow-overlay backdrop:bg-backdrop-film backdrop:backdrop-blur-(--backdrop-blur)",
				wide ? "w-3xl" : "w-xl",
				className,
			)}
			aria-labelledby={id}
			onCancel={(event) => {
				event.preventDefault();
				requestClose();
			}}
			onClick={(event) => {
				if (event.target === event.currentTarget) requestClose();
			}}
		>
			<motion.div
				ref={panelRef}
				tabIndex={focusPanelOnOpen ? -1 : undefined}
				className="focus:outline-none"
				initial={initial}
				animate={closing ? exit : enter}
				transition={{
					duration: reduceMotion ? 0 : closing ? 0.12 : 0.15,
					ease: "easeOut",
				}}
				onAnimationComplete={() => {
					if (closing) onClose();
				}}
			>
				<div className={mergeStyles(dialogHeaderStyles, headerClassName)}>
					<div className="min-w-0 flex-1">
						{eyebrow && (
							<p className="mb-2 text-xs font-bold tracking-widest text-muted">
								{eyebrow}
							</p>
						)}
						<h2
							id={id}
							className={
								titleSize === "plain"
									? "text-sm leading-snug font-semibold tracking-normal"
									: "type-display text-3xl leading-tight font-normal tracking-tight"
							}
						>
							{title}
						</h2>
					</div>
					<div className="flex flex-none flex-wrap items-center justify-end gap-1">
						{actions}
						<IconButton icon={X} label="Close dialog" onClick={requestClose} />
					</div>
				</div>
				<div className={mergeStyles(dialogBodyStyles, bodyClassName)}>
					{children}
				</div>
			</motion.div>
		</dialog>
	);
}
