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
	const mobile = useMobileNavigation();
	return (
		<div className="app-shell">
			<a className="skip-link" href="#main-content">
				Skip to main content
			</a>
			{mobile.open && (
				<button
					type="button"
					className="nav-backdrop"
					aria-label="Close navigation"
					onClick={mobile.close}
				/>
			)}
			<aside
				ref={mobile.sidebarRef}
				className={`sidebar ${mobile.open ? "sidebar-open" : ""}`}
				inert={mobile.mobile && !mobile.open}
				{...(mobile.open
					? { role: "dialog", "aria-modal": true as const }
					: {})}
				aria-label="Workspace navigation"
			>
				{navigation(mobile.close)}
			</aside>
			<div className="workspace" inert={mobile.open}>
				{header(mobile.show)}
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
