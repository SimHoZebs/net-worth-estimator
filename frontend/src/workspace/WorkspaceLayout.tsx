import type { ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useMobileNavigation } from "./useMobileNavigation.ts";

export function WorkspaceLayout({
	navigation,
	header,
	children,
	draftBar,
	overlays,
	notification,
}: {
	navigation: (close: () => void) => ReactNode;
	header: (open: () => void) => ReactNode;
	children: ReactNode;
	draftBar: ReactNode;
	overlays: ReactNode;
	notification: ReactNode;
}) {
	const {
		open,
		mobile: isMobile,
		sidebarRef,
		close,
		show,
	} = useMobileNavigation();
	const reduceMotion = useReducedMotion();
	return (
		<div className="app-shell">
			<a className="skip-link" href="#main-content">
				Skip to main content
			</a>
			<AnimatePresence>
				{open && (
					<motion.button
						key="nav-backdrop"
						type="button"
						className="nav-backdrop"
						aria-label="Close navigation"
						onClick={close}
						initial={{ opacity: 0 }}
						animate={{ opacity: 1 }}
						exit={{ opacity: 0 }}
						transition={{ duration: reduceMotion ? 0 : 0.15 }}
					/>
				)}
			</AnimatePresence>
			<motion.aside
				ref={sidebarRef}
				className={`sidebar ${open ? "sidebar-open" : ""}`}
				inert={isMobile && !open}
				{...(open ? { role: "dialog", "aria-modal": true as const } : {})}
				aria-label="Workspace navigation"
				initial={false}
				animate={{ x: open || !isMobile ? "0%" : "-100%" }}
				transition={{
					duration: reduceMotion ? 0 : 0.2,
					ease: "easeOut",
				}}
			>
				{navigation(close)}
			</motion.aside>
			<div className="workspace" inert={open}>
				{header(show)}
				<main id="main-content" className="main-content">
					{children}
				</main>
				{draftBar}
			</div>
			{overlays}
			{notification}
		</div>
	);
}
