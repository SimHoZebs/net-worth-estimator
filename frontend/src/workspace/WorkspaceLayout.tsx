import type { ReactNode } from "react";
import { Drawer } from "../components/Drawer.tsx";
import { NotificationCenter } from "../components/NotificationCenter.tsx";
import { useMobileNavigation } from "./useMobileNavigation.ts";

export function WorkspaceLayout({
	navigation,
	header,
	children,
}: {
	navigation: (close: () => void) => ReactNode;
	header: (open: () => void) => ReactNode;
	children: ReactNode;
}) {
	const { open, mobile, close, show } = useMobileNavigation();
	return (
		<div className="min-h-screen">
			<a
				className="fixed -top-20 left-60 z-100 rounded-surface bg-primary px-5 py-3 text-on-primary focus:top-3 max-md:left-5"
				href="#main-content"
			>
				Skip to main content
			</a>
			<Drawer
				side="left"
				open={open || !mobile}
				onClose={close}
				label="Workspace navigation"
				behavior={{ modal: mobile, swipeClose: mobile }}
			>
				{navigation(close)}
			</Drawer>
			<div className="relative ml-(--sidebar) flex min-h-dvh flex-col print:ml-0">
				{header(show)}
				<main
					id="main-content"
					className="mx-auto w-full max-w-7xl flex-1 px-5 py-6 sm:px-6 md:py-8 xl:px-8 print:p-0"
				>
					{children}
				</main>
				<NotificationCenter />
			</div>
		</div>
	);
}
