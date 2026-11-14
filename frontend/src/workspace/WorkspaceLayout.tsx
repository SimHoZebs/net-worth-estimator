import type { ReactNode } from "react";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet.tsx";
import { NotificationCenter } from "../components/NotificationCenter.tsx";
import { useModalRegistration } from "../state/modalPresence.ts";
import { BreadcrumbSlotProvider } from "./breadcrumbSlot.tsx";
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
	// The mobile sheet is modal: it must block the window swipe gesture from
	// stacking navigation above an open dialog, same as the dialogs do.
	useModalRegistration(open && mobile);
	return (
		<BreadcrumbSlotProvider>
			<div className="min-h-screen">
				<a
					className="fixed -top-20 left-60 z-(--z-skip) rounded-surface bg-primary px-5 py-3 text-on-primary focus:top-3 max-md:left-5"
					href="#main-content"
				>
					Skip to main content
				</a>
				{mobile ? (
					<Sheet
						open={open}
						onOpenChange={(next) => {
							if (!next) close();
						}}
					>
						<SheetContent
							side="left"
							showCloseButton={false}
							className="w-60 max-w-[calc(100vw-3rem)] px-5 pt-6 pb-0"
						>
							<SheetTitle className="sr-only">Workspace navigation</SheetTitle>
							{navigation(close)}
						</SheetContent>
					</Sheet>
				) : (
					<aside
						aria-label="Workspace navigation"
						className="fixed inset-y-0 left-0 z-(--z-sheet) flex w-(--sidebar-width) flex-col overflow-y-auto border-0 border-r border-solid border-line bg-surface px-5 pt-8 pb-0 text-ink max-xl:px-3 print:hidden"
					>
						{navigation(close)}
					</aside>
				)}
				<div className="relative ml-(--sidebar-width) flex min-h-dvh flex-col print:ml-0">
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
		</BreadcrumbSlotProvider>
	);
}
