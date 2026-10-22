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
		<div className="min-h-screen">
			<a
				className="fixed -top-20 left-60 z-100 rounded-lg bg-primary px-5 py-3 text-on-primary focus:top-3 [@media(max-width:800px)]:left-5"
				href="#main-content"
			>
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
			<div className="ml-(--sidebar) print:ml-0" inert={open}>
				{header(show)}
				<main
					id="main-content"
					className="mx-auto max-w-384 px-10 pt-8 pb-6 [body:has([data-draft-bar])_&]:pb-32 [@media(max-width:1250px)]:px-7 [@media(max-width:800px)]:px-6 [@media(max-width:800px)]:py-7 [@media(max-width:600px)]:px-5 [@media(max-width:600px)]:py-6 [@media(max-width:600px)]:[body:has([data-draft-bar])_&]:pb-40 print:p-0"
				>
					{children}
				</main>
				{draftBar}
			</div>
			{overlays}
			{notification}
		</div>
	);
}
