import { X } from "lucide-react";
import { motion } from "motion/react";
import {
	type ReactNode,
	useEffect,
	useEffectEvent,
	useId,
	useRef,
	useState,
} from "react";
import { createPortal } from "react-dom";
import { mergeStyles } from "./mergeStyles.ts";
import { useMediaQuery, viewportQueries } from "../state/useMediaQuery.ts";
import {
	acquireModalLock,
	drawerHiddenX,
	releaseModalLock,
	useDrawerBackdropTransition,
	useDrawerTransition,
	useHorizontalSwipe,
	type DrawerSide,
} from "../state/drawer.ts";
import {
	isTopmostModal,
	useOpenModalRegistration,
} from "../state/modalStack.ts";
import { IconButton } from "./Button.tsx";
import { dialogBodyStyles, dialogHeaderStyles } from "./dialogStyles.ts";

// The single drawer component: the left navigation sheet and the right
// context sheet are the same backdrop, slide, border, focus, and gesture
// behavior with mirrored sides. Call sites configure width (sheet or full),
// modality, backdrop, and swipe; they never reimplement the frame.
interface DrawerProps {
	side: DrawerSide;
	open: boolean;
	onClose: () => void;
	label: string;
	appearance?: {
		title?: string;
		eyebrow?: string;
		coverage?: "sheet" | "full";
		full?: boolean;
		headerClassName?: string;
		bodyClassName?: string;
	};
	behavior?: {
		modal?: boolean;
		backdrop?: boolean;
		swipeClose?: boolean;
		/** Sync panel focus on open. The mobile navigation skips it to avoid
		 * a focus jump on open; containment still returns stray focus to
		 * the panel while open. No child is ever focused. */
		autoFocus?: boolean;
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
		full,
		headerClassName,
		bodyClassName,
	} = appearance ?? {};
	const {
		modal = true,
		backdrop = true,
		swipeClose = true,
		autoFocus = true,
	} = behavior ?? {};
	const panelEl = useRef<HTMLElement | null>(null);
	const titleId = useId();
	// The element that held focus when the modal drawer opened. Captured once
	// per open session (never overwritten by StrictMode remounts, which would
	// see focus already inside the drawer) so focus reliably returns to the
	// opener on close. A fresh mount starts empty, so reopening captures anew.
	const openerRef = useRef<Element | null>(null);
	const [closing, setClosing] = useState(false);
	// Once-only close: motion reports completion per animated value, so the
	// first close completion wins and replayed exits stay silent. Written only
	// in the animation callback, never mirrored by an effect.
	const closeNotifiedRef = useRef(false);
	// The stack lives in React state, not a document query: only modal sheets count.
	// The persistent desktop sheet stays unregistered. The id backs the
	// topmost check so stacked sheets never fight over focus.
	const modalId = useOpenModalRegistration(modal);
	const queriedFull = useMediaQuery(viewportQueries.belowSm);
	const isFull = full ?? queriedFull;
	const drawerTransition = useDrawerTransition(closing);
	const backdropTransition = useDrawerBackdropTransition();
	const hiddenX = drawerHiddenX(side, isFull);
	const requestClose = () => {
		setClosing(true);
	};
	// Native listeners read latest props and state through these events, so
	// the subscription below never mirrors onClose or closing into refs and
	// never resubscribes for them.
	const handleKeyDown = useEffectEvent((event: KeyboardEvent) => {
		if (event.key !== "Escape") return;
		// The topmost modal owns Escape even when opening the inert
		// background blurs the opener before focus enters the panel.
		// Persistent navigation and sheets below a native dialog stay silent.
		if (modal && isTopmostModal(modalId)) {
			event.preventDefault();
			requestClose();
		}
	});
	// Focus stays in the topmost panel while open. Any focusin outside
	// returns to that panel only; lower sheets sleep. The stack is read
	// live so overlapping sheets never act on a stale closure.
	const handleFocusIn = useEffectEvent((event: FocusEvent) => {
		if (!modal || closing) return;
		if (!isTopmostModal(modalId)) return;
		const target = event.target as Node | null;
		const panel = panelEl.current;
		if (!panel || !target) return;
		if (!panel.contains(target)) panel.focus({ preventScroll: true });
	});
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
	useEffect(() => {
		if (modal && openerRef.current === null)
			openerRef.current = document.activeElement;
		// Focus lands on the panel container itself, never on a child, so
		// no brand link or value ever takes a focus ring on open. The
		// persistent desktop sheet never moves focus on load.
		if (modal && autoFocus && isTopmostModal(modalId)) {
			panelEl.current?.focus({ preventScroll: true });
		}
		window.addEventListener("keydown", handleKeyDown);
		window.addEventListener("focusin", handleFocusIn);
		return () => {
			window.removeEventListener("keydown", handleKeyDown);
			window.removeEventListener("focusin", handleFocusIn);
			const opener = openerRef.current;
			if (modal && opener instanceof HTMLElement && opener.isConnected) {
				// The inert effect below removes the #root inertness in its
				// own cleanup. Focusing must wait until that runs: elements
				// inside an inert subtree refuse focus, so a synchronous
				// restore here would silently land on <body> instead.
				const target = opener;
				requestAnimationFrame(() => {
					if (target.isConnected) target.focus();
				});
			}
		};
		// Mount plus modality transitions: a desktop sheet that becomes modal
		// captures and focuses like a fresh open. The listeners stay current
		// through the events above, so closing needs no dependency or mirror.
		// oxlint-disable-next-line react/exhaustive-deps
	}, [modal, autoFocus, modalId]);
	useEffect(() => {
		if (!modal) return;
		// Shared lock: overlapping sheets must not restore scroll or remove
		// inertness while the other sheet is still open.
		acquireModalLock();
		return () => {
			releaseModalLock();
		};
	}, [modal]);
	const slide = {
		initial: { opacity: 0, x: hiddenX },
		animate: { opacity: 1, x: 0 },
		exit: { opacity: 0, x: hiddenX },
	};
	// Direct render prop: the latest onClose runs once when the exit
	// animation completes, with no ref mirror in between.
	const handleAnimationComplete = () => {
		if (!panelEl.current?.isConnected || !closing || closeNotifiedRef.current)
			return;
		closeNotifiedRef.current = true;
		onClose();
	};
	// The session implies open. Unmount ends its lifetime without a reset.
	return (
		<>
			{backdrop && (
				<motion.button
					key="drawer-backdrop"
					type="button"
					className={`fixed inset-0 border-0 bg-backdrop-film backdrop-blur-(--backdrop-blur) ${side === "left" ? "z-29" : "z-40"}`}
					aria-label={`Close ${label}`}
					onClick={requestClose}
					initial={{ opacity: 0 }}
					animate={{ opacity: closing ? 0 : 1 }}
					transition={closing ? drawerTransition : backdropTransition}
				/>
			)}
			{side === "left" ? (
				<motion.aside
					key="drawer_panel"
					ref={(node) => {
						panelEl.current = node;
					}}
					className="fixed inset-y-0 left-0 z-30 flex w-(--sidebar) touch-pan-y flex-col overflow-y-auto border-0 border-r border-solid border-line bg-surface px-5 pt-8 text-ink focus:outline-none max-xl:px-3 max-md:w-60 max-md:px-5 max-md:pt-6 max-md:shadow-2xl print:hidden"
					aria-label={label}
					tabIndex={-1}
					{...(modal ? { role: "dialog", "aria-modal": true as const } : {})}
					initial={slide.initial}
					animate={closing ? slide.exit : slide.animate}
					transition={drawerTransition}
					onAnimationComplete={handleAnimationComplete}
				>
					{children}
				</motion.aside>
			) : (
				<motion.div
					key="drawer_panel"
					ref={(node) => {
						panelEl.current = node;
					}}
					className={mergeStyles(
						"fixed inset-y-0 right-0 z-41 flex w-3xl max-w-[calc(100%_-_--spacing(12))] touch-pan-y flex-col overflow-y-auto border-0 border-l border-solid border-line bg-surface text-ink focus:outline-none max-sm:w-md max-sm:shadow-overlay",
						coverage === "full" &&
							"max-sm:w-full max-sm:max-w-full max-sm:border-l-0 max-sm:shadow-none",
					)}
					tabIndex={-1}
					role="dialog"
					aria-modal="true"
					aria-labelledby={titleId}
					initial={slide.initial}
					animate={closing ? slide.exit : slide.animate}
					transition={drawerTransition}
					onAnimationComplete={handleAnimationComplete}
				>
					{title && (
						<div className={mergeStyles(dialogHeaderStyles, headerClassName)}>
							<div className="min-w-0 flex-1">
								{eyebrow && (
									<p className="mb-2 text-xs font-bold tracking-widest text-muted">
										{eyebrow}
									</p>
								)}
								<h2
									id={titleId}
									className="type-display text-3xl leading-tight font-normal tracking-tight"
								>
									{title}
								</h2>
							</div>
							<IconButton
								icon={X}
								label="Close dialog"
								onClick={requestClose}
							/>
						</div>
					)}
					<div className={mergeStyles(dialogBodyStyles, bodyClassName)}>
						{children}
					</div>
				</motion.div>
			)}
		</>
	);
}
