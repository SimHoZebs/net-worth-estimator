import type { ReactNode } from "react";
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
	return (
		<div className="app-shell">
			<a className="skip-link" href="#main-content">
				Skip to main content
			</a>
			{open && (
				<button
					type="button"
					className="nav-backdrop"
					aria-label="Close navigation"
					onClick={close}
				/>
			)}
			<aside
				ref={sidebarRef}
				className={`sidebar ${open ? "sidebar-open" : ""}`}
				inert={isMobile && !open}
				{...(open ? { role: "dialog", "aria-modal": true as const } : {})}
				aria-label="Workspace navigation"
			>
				{navigation(close)}
			</aside>
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
