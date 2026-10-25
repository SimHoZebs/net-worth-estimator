import type { ReactNode } from "react";
import { Drawer } from "../components/Drawer.tsx";
import { NotificationCenter } from "../components/NotificationCenter.tsx";
import { useMobileNavigation } from "./useMobileNavigation.ts";

export function WorkspaceLayout({
	navigation,
	header,
	children,
	draftBar,
	overlays,
}: {
	navigation: (close: () => void) => ReactNode;
	header: (open: () => void) => ReactNode;
	children: ReactNode;
	draftBar: ReactNode;
	overlays: ReactNode;
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
				appearance={{ full: mobile }}
				behavior={{
					backdrop: mobile,
					modal: mobile,
					swipeClose: mobile,
					autoFocus: false,
				}}
			>
				{navigation(close)}
			</Drawer>
			<div
				className="ml-(--sidebar) flex min-h-dvh flex-col print:ml-0"
				inert={mobile && open}
			>
				{header(show)}
				<main
					id="main-content"
					className="mx-auto w-full max-w-7xl flex-1 px-5 py-6 sm:px-6 md:py-8 xl:px-8 print:p-0"
				>
					{children}
				</main>
				<div className="pointer-events-none sticky bottom-3 z-50 mx-auto flex w-full max-w-7xl flex-col items-end gap-3 px-5 empty:hidden sm:bottom-5 sm:px-6 xl:px-8 print:hidden">
					<NotificationCenter />
					{draftBar}
				</div>
			</div>
			{overlays}
		</div>
	);
}
