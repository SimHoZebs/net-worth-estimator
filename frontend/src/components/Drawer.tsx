import { X } from "lucide-react";
import {
	useCallback,
	type AnimationEvent,
	type MouseEvent,
	type ReactNode,
	useEffect,
	useId,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { mergeStyles } from "./mergeStyles.ts";
import { useModalRegistration } from "../state/modalPresence.ts";
import {
	DRAWER_CLOSE_DURATION,
	useHorizontalSwipe,
	type DrawerSide,
} from "../state/drawer.ts";
import { usePrefersReducedMotion } from "../state/useMediaQuery.ts";
import { IconButton } from "./Button.tsx";
import {
	dialogBodyStyles,
	dialogEyebrowStyles,
	dialogHeaderStyles,
	dialogTitleDisplayStyles,
} from "./dialogStyles.ts";

// The single drawer component: the left navigation sheet and the right
// context sheet are the same backdrop, slide, border, focus, and gesture
// behavior with mirrored sides. Call sites configure width (sheet or full),
// modality, and swipe; they never reimplement the frame.
interface DrawerProps {
	side: DrawerSide;
	open: boolean;
	onClose: () => void;
	label: string;
	appearance?: {
		title?: string;
		eyebrow?: string;
		coverage?: "sheet" | "full";
		headerClassName?: string;
		bodyClassName?: string;
	};
	behavior?: {
		modal?: boolean;
		swipeClose?: boolean;
	};
	children: ReactNode;
}

export function Drawer({
	side,
	open,
	onClose,
	label,
	appearance,
	behavior,
	children,
}: DrawerProps) {
	// Explicit dismissal animates before onClose. External navigation ends
	// the session immediately, so a rapid reopen cannot reuse an old close.
	if (!open) return null;
	return createPortal(
		<DrawerSession
			side={side}
			onClose={onClose}
			label={label}
			appearance={appearance}
			behavior={behavior}
		>
			{children}
		</DrawerSession>,
		document.body,
	);
}

// One open drawer session. Closing mirrors Modal: the exit animation plays
// first, the parent's onClose (hash navigation, unmount) runs after it
// completes. Every close path (Escape, backdrop, button, swipe) funnels
// through the same requestClose so none skips the animation.
function DrawerSession({
	side,
	onClose,
	label,
	appearance,
	behavior,
	children,
}: Omit<DrawerProps, "open">) {
	const {
		title,
		eyebrow,
		coverage = "sheet",
		headerClassName,
		bodyClassName,
	} = appearance ?? {};
	const { modal = true, swipeClose = true } = behavior ?? {};
	useModalRegistration(modal);
	const panelEl = useRef<HTMLElement | null>(null);
	const titleId = useId();
	const [closing, setClosing] = useState(false);
	// Once-only close: the exit animation and the fallback timer can both
	// report completion, and only the first report may unmount the panel.
	const closeNotifiedRef = useRef(false);
	const reduceMotion = usePrefersReducedMotion();
	const requestClose = () => {
		if (closeNotifiedRef.current) return;
		// No exit frame under reduced motion: unmount in the same event so
		// closing is instant for users who asked for no animation.
		if (reduceMotion) {
			closeNotifiedRef.current = true;
			onClose();
			return;
		}
		setClosing(true);
	};
	// The modal sheet is a native dialog: the browser owns the top layer,
	// page inertness, Tab containment, Escape, and focus return to the
	// opener. The persistent desktop sheet stays a complementary aside.
	useLayoutEffect(() => {
		if (!modal) return;
		const panel = panelEl.current;
		if (!(panel instanceof HTMLDialogElement)) return;
		panel.showModal();
		// Focus the panel container itself, never a child, so no brand link
		// or value ever takes a focus ring on open.
		panel.focus({ preventScroll: true });
		return () => panel.close();
	}, [modal]);
	// A click on the backdrop targets the dialog itself. The dialog box is
	// the sheet, so only coordinates outside its rectangle dismiss it; a
	// click on the sheet padding stays inside.
	const closeIfBackdrop = (event: MouseEvent<HTMLDialogElement>) => {
		if (event.target !== event.currentTarget) return;
		const rect = event.currentTarget.getBoundingClientRect();
		const inside =
			event.clientX >= rect.left &&
			event.clientX <= rect.right &&
			event.clientY >= rect.top &&
			event.clientY <= rect.bottom;
		if (!inside) requestClose();
	};
	// Closing swipes travel toward the docked edge: leftward for the left
	// drawer, rightward for the right drawer. Opening is the call site's
	// own gesture; this component only reports its direction.
	const closeIfOver = (_dx: number, origin: EventTarget | null) => {
		if (origin instanceof Node && panelEl.current?.contains(origin)) {
			requestClose();
		}
	};
	useHorizontalSwipe({
		enabled: !closing && swipeClose,
		...(side === "left"
			? { onSwipeLeft: closeIfOver }
			: { onSwipeRight: closeIfOver }),
	});
	// Once-only close: the exit animation and the fallback timer can both
	// report completion, so the first report owns onClose.
	const finishClose = useCallback(() => {
		if (!panelEl.current?.isConnected || !closing || closeNotifiedRef.current)
			return;
		closeNotifiedRef.current = true;
		onClose();
	}, [closing, onClose]);
	// animationend covers the normal path. The timer covers environments
	// that never run animations (jsdom) and an interrupted exit.
	useEffect(() => {
		if (!closing) return;
		const timer = window.setTimeout(
			finishClose,
			reduceMotion ? 0 : DRAWER_CLOSE_DURATION + 40,
		);
		return () => window.clearTimeout(timer);
	}, [closing, finishClose, reduceMotion]);
	const handleAnimationEnd = (event: AnimationEvent<HTMLElement>) => {
		if (event.target !== event.currentTarget) return;
		finishClose();
	};
	const panelState = closing ? "closed" : "open";
	const panelClassName = mergeStyles(
		"fixed inset-y-0 touch-pan-y flex-col overflow-y-auto border-0 border-solid border-line bg-surface text-ink focus:outline-none",
		side === "left"
			? "right-auto left-0 w-(--sidebar) border-r px-5 pt-8 pb-0 max-xl:px-3 max-md:w-60 max-md:px-5 max-md:pt-6 max-md:shadow-2xl print:hidden"
			: "left-auto right-0 w-3xl max-w-[calc(100%_-_--spacing(12))] border-l p-0 max-sm:w-md max-sm:shadow-overlay",
		side === "right" &&
			coverage === "full" &&
			"max-sm:w-full max-sm:max-w-full max-sm:border-l-0 max-sm:shadow-none",
	);
	// The navigation sheet owns its own padding; only the context sheet has
	// a dialog header and a padded body.
	const body =
		side === "left" ? (
			children
		) : (
			<>
				{title && (
					<div className={mergeStyles(dialogHeaderStyles, headerClassName)}>
						<div className="min-w-0 flex-1">
							{eyebrow && (
								<p className={dialogEyebrowStyles}>{eyebrow}</p>
							)}
							<h2 id={titleId} className={dialogTitleDisplayStyles}>
								{title}
							</h2>
						</div>
						<IconButton icon={X} label="Close dialog" onClick={requestClose} />
					</div>
				)}
				<div className={mergeStyles(dialogBodyStyles, bodyClassName)}>
					{children}
				</div>
			</>
		);
	const accessibleName = title
		? { "aria-labelledby": titleId }
		: { "aria-label": label };
	// The session implies open. Unmount ends its lifetime without a reset.
	if (modal)
		return (
			<dialog
				key="drawer_panel"
				ref={(node) => {
					panelEl.current = node;
				}}
				className={mergeStyles(
					panelClassName,
					"waypoint-drawer m-0 h-auto max-h-none open:flex backdrop:bg-backdrop-film backdrop:backdrop-blur-(--backdrop-blur)",
					side === "left" && "max-w-none",
				)}
				data-side={side}
				data-state={panelState}
				tabIndex={-1}
				{...accessibleName}
				onAnimationEnd={handleAnimationEnd}
				onCancel={(event) => {
					// React bubbles cancel through portal ancestry, so a
					// nested sheet must not also start closing.
					event.stopPropagation();
					event.preventDefault();
					requestClose();
				}}
				onClick={closeIfBackdrop}
			>
				{body}
			</dialog>
		);
	return (
		<aside
			key="drawer_panel"
			ref={(node) => {
				panelEl.current = node;
			}}
			className={mergeStyles(
				panelClassName,
				"waypoint-drawer z-(--z-sheet) flex",
			)}
			data-side={side}
			data-state={panelState}
			tabIndex={-1}
			aria-label={label}
			onAnimationEnd={handleAnimationEnd}
		>
			{body}
		</aside>
	);
}
