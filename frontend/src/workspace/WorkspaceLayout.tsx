import type { ReactNode } from "react";
import { Drawer } from "../components/Drawer.tsx";
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
	const { open, mobile, close, show } = useMobileNavigation();
	return (
		<div className="app-shell">
			<a className="skip-link" href="#main-content">
				Skip to main content
			</a>
			<Drawer
				side="left"
				open={open || !mobile}
				onClose={close}
				label="Workspace navigation"
				appearance={{ full: mobile }}
				behavior={{ backdrop: mobile, modal: mobile, swipeClose: mobile }}
			>
				{navigation(close)}
			</Drawer>
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
