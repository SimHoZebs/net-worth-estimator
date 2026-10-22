import { X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { mergeStyles } from "./mergeStyles.ts";
import { useMediaQuery, viewportQueries } from "../state/useMediaQuery.ts";
import {
	drawerHiddenX,
	useDrawerBackdropTransition,
	useDrawerTransition,
	useHorizontalSwipe,
	type DrawerSide,
} from "./drawer.ts";
import { IconButton } from "./ui.tsx";
import { dialogBodyStyles, dialogHeaderStyles } from "./dialogStyles.ts";

// The single drawer component: the left navigation sheet and the right
// context sheet are the same backdrop, slide, border, focus, and gesture
// behavior with mirrored sides. Call sites configure width (sheet or full),
// modality, backdrop, and swipe; they never reimplement the frame.
export function Drawer({
	side,
	open,
	onClose,
	label,
	appearance,
	behavior,
	children,
}: {
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
	};
	children: ReactNode;
}) {
	const {
		title,
		eyebrow,
		coverage = "sheet",
		full,
		headerClassName,
		bodyClassName,
	} = appearance ?? {};
	const { modal = true, backdrop = true, swipeClose = true } = behavior ?? {};
	const panelEl = useRef<Element | null>(null);
	const titleId = useId();
	// The element that held focus when the drawer opened. Captured once per
	// open cycle (never overwritten by StrictMode remounts or later
	// re-runs, which would see focus already inside the drawer) so focus
	// reliably returns to the opener on close.
	const openerRef = useRef<Element | null>(null);
	// Starts false so the first open always captures, including drawers
	// that mount already open. Refs survive StrictMode remounts, so later
	// runs keep the original opener.
	const wasOpenRef = useRef(false);
	// Closing mirrors Modal: the exit animation plays first, the parent's
	// onClose (hash navigation, unmount) runs after it completes.
	const [closing, setClosing] = useState(false);
	const closeRef = useRef(onClose);
	useEffect(() => {
		closeRef.current = onClose;
	});
	const queriedFull = useMediaQuery(viewportQueries.belowSm);
	const isFull = full ?? queriedFull;
	const drawerTransition = useDrawerTransition(closing);
	const backdropTransition = useDrawerBackdropTransition();
	const hiddenX = drawerHiddenX(side, isFull);
	// The drawer stays mounted across open cycles (only its portal content
	// unmounts), so a completed animated close must reset. Otherwise the
	// next open renders already in the exit position and immediately
	// re-triggers onClose, making the drawer impossible to reopen.
	useEffect(() => {
		// oxlint-disable-next-line react/set-state-in-effect
		if (!open) setClosing(false);
	}, [open]);
	const requestClose = () => {
		setClosing(true);
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
		enabled: open && !closing && swipeClose,
		...(side === "left"
			? { onSwipeLeft: closeIfOver }
			: { onSwipeRight: closeIfOver }),
	});
	useEffect(() => {
		if (open && !wasOpenRef.current) openerRef.current = document.activeElement;
		wasOpenRef.current = open;
		if (!open) return;
		const previous = openerRef.current ?? document.activeElement;
		// Modal drawers take focus on open; the persistent desktop
		// navigation must never steal it on page load.
		if (modal) {
			panelEl.current?.querySelector<HTMLElement>("button, a[href]")?.focus();
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				// Only the drawer holding focus handles Escape. A persistent
				// drawer (desktop navigation) must never preventDefault here:
				// that would swallow the keydown a native <dialog> above it
				// needs to fire its own cancel event.
				if (panelEl.current?.contains(document.activeElement)) {
					event.preventDefault();
					closeRef.current();
				}
				return;
			}
			if (event.key !== "Tab") return;
			const elements = Array.from(
				panelEl.current?.querySelectorAll<HTMLElement>(
					'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])',
				) ?? [],
			);
			const first = elements[0];
			const last = elements.at(-1);
			if (event.shiftKey && document.activeElement === first) {
				event.preventDefault();
				last?.focus();
			}
			if (!event.shiftKey && document.activeElement === last) {
				event.preventDefault();
				first?.focus();
			}
		};
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("keydown", onKey);
			if (previous instanceof HTMLElement && previous.isConnected) {
				// The inert effect below removes the #root inertness in its
				// own cleanup. Focusing must wait until that runs: elements
				// inside an inert subtree refuse focus, so a synchronous
				// restore here would silently land on <body> instead.
				const target = previous;
				requestAnimationFrame(() => {
					if (target.isConnected) target.focus();
				});
			}
		};
	}, [open, modal]);
	useEffect(() => {
		if (!open || !modal) return;
		const root = document.getElementById("root");
		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = "hidden";
		root?.setAttribute("inert", "");
		return () => {
			document.body.style.overflow = previousOverflow;
			root?.removeAttribute("inert");
		};
	}, [open, modal]);
	const slide = {
		initial: { opacity: 0, x: hiddenX },
		animate: { opacity: 1, x: 0 },
		exit: { opacity: 0, x: hiddenX },
	};
	return createPortal(
		<AnimatePresence>
			{open && (
				<>
					{backdrop && (
						<motion.button
							key="drawer-backdrop"
							type="button"
							className={`fixed inset-0 border-0 bg-backdrop-film backdrop-blur-(--backdrop-blur) ${side === "left" ? "z-29" : "z-40"}`}
							aria-label={`Close ${label}`}
							onClick={requestClose}
							initial={{ opacity: 0 }}
							animate={{ opacity: 1 }}
							exit={{ opacity: 0 }}
							transition={backdropTransition}
						/>
					)}
					{side === "left" ? (
						<motion.aside
							key="drawer_panel"
							ref={(node) => {
								panelEl.current = node;
							}}
							className="fixed inset-y-0 left-0 z-30 flex w-(--sidebar) touch-pan-y flex-col overflow-y-auto border-0 border-r border-solid border-line bg-surface px-5 pt-8 text-ink max-xl:px-3 max-md:w-60 max-md:px-5 max-md:pt-6 max-md:shadow-2xl print:hidden"
							aria-label={label}
							{...(modal
								? { role: "dialog", "aria-modal": true as const }
								: {})}
							initial={slide.initial}
							animate={closing ? slide.exit : slide.animate}
							exit={slide.exit}
							transition={drawerTransition}
							onAnimationComplete={() => {
								if (closing) closeRef.current();
							}}
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
								"fixed inset-y-0 right-0 z-41 flex w-3xl max-w-[calc(100%_-_--spacing(12))] touch-pan-y flex-col overflow-y-auto border-0 border-l border-solid border-line bg-surface text-ink max-sm:w-md max-sm:shadow-overlay",
								coverage === "full" &&
									"max-sm:w-full max-sm:max-w-full max-sm:border-l-0 max-sm:shadow-none",
							)}
							role="dialog"
							aria-modal="true"
							aria-labelledby={titleId}
							initial={slide.initial}
							animate={closing ? slide.exit : slide.animate}
							exit={slide.exit}
							transition={drawerTransition}
							onAnimationComplete={() => {
								if (closing) closeRef.current();
							}}
						>
							{title && (
								<div
									className={mergeStyles(dialogHeaderStyles, headerClassName)}
								>
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
			)}
		</AnimatePresence>,
		document.body,
	);
}
