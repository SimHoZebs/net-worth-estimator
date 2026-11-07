import { X } from "lucide-react";
import {
	type AnimationEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { IconButton } from "./Button.tsx";
import { useModalRegistration } from "../state/modalPresence.ts";
import { dialogBodyStyles, dialogHeaderStyles } from "./dialogStyles.ts";
import { mergeStyles } from "./mergeStyles.ts";
import { usePrefersReducedMotion } from "../state/useMediaQuery.ts";

const MODAL_CLOSE_DURATION = 120;

export function Modal({
	title,
	label,
	eyebrow,
	children,
	onClose,
	onCloseRequest,
	className = "",
	headerClassName,
	bodyClassName,
	titleSize = "display",
	actions,
	focusPanelOnOpen = false,
}: {
	title: ReactNode;
	/** Stable accessible name for titles that contain editable controls. */
	label?: string;
	eyebrow?: string;
	children: ReactNode;
	onClose: () => void;
	/** Return false to keep the dialog visible, such as for unsaved-form confirmation. */
	onCloseRequest?: () => boolean;
	/** Legacy: centered dialogs share one size regardless of content. */
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
	useModalRegistration(true);
	const [closing, setClosing] = useState(false);
	const closeRequested = useRef(false);
	const closeNotified = useRef(false);
	const reduceMotion = usePrefersReducedMotion();
	const id = useId();
	useLayoutEffect(() => {
		const dialog = ref.current;
		dialog?.showModal();
		if (focusPanelOnOpen) panelRef.current?.focus();
		// Layout cleanup runs before React detaches the dialog, so close()
		// still returns focus to the opener.
		return () => dialog?.close();
		// oxlint-disable-next-line react/exhaustive-deps
	}, []);
	const requestClose = () => {
		if (closeRequested.current) return;
		if (onCloseRequest?.() === false) return;
		closeRequested.current = true;
		// No exit frame under reduced motion: unmount in the same event so
		// closing is instant for users who asked for no animation.
		if (reduceMotion) {
			closeNotified.current = true;
			onClose();
			return;
		}
		setClosing(true);
	};
	// Centered dialogs scale/fade in CSS. Drawer sheets are the shared
	// Drawer component; the native <dialog> stays static so showModal
	// top-layer, focus, and backdrop behavior are unchanged.
	const finishClose = useCallback(() => {
		if (!closing || closeNotified.current) return;
		closeNotified.current = true;
		onClose();
	}, [closing, onClose]);
	useEffect(() => {
		if (!closing) return;
		const timer = window.setTimeout(
			finishClose,
			reduceMotion ? 0 : MODAL_CLOSE_DURATION + 40,
		);
		return () => window.clearTimeout(timer);
	}, [closing, finishClose, reduceMotion]);
	const handleAnimationEnd = (event: AnimationEvent<HTMLDivElement>) => {
		if (event.target !== event.currentTarget) return;
		finishClose();
	};
	return (
		<dialog
			ref={ref}
			className={mergeStyles(
				"h-[80dvh] max-h-[80dvh] w-3xl max-w-[calc(100%_-_--spacing(6))] overflow-hidden rounded-surface border border-solid border-line-strong bg-surface p-0 text-ink shadow-overlay backdrop:bg-backdrop-film backdrop:backdrop-blur-(--backdrop-blur)",
				className,
			)}
			aria-labelledby={label ? undefined : id}
			aria-label={label}
			onCancel={(event) => {
				event.preventDefault();
				// React also bubbles cancel events through portal ancestry. Only
				// the top dialog may act, or a parent can discard a blocked edit.
				event.stopPropagation();
				requestClose();
			}}
			onClick={(event) => {
				if (event.target === event.currentTarget) requestClose();
			}}
		>
			<div
				ref={panelRef}
				tabIndex={focusPanelOnOpen ? -1 : undefined}
				className="waypoint-modal-panel flex h-full min-h-0 flex-col gap-4 focus:outline-none max-sm:min-h-full"
				data-state={closing ? "closed" : "open"}
				onAnimationEnd={handleAnimationEnd}
			>
				<div
					className={mergeStyles(
						"flex-none",
						dialogHeaderStyles,
						headerClassName,
					)}
				>
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
				<div
					className={mergeStyles(
						dialogBodyStyles,
						"min-h-0 flex-1 overflow-y-auto pt-0 max-sm:pt-0",
						bodyClassName,
					)}
				>
					{children}
				</div>
			</div>
		</dialog>
	);
}
