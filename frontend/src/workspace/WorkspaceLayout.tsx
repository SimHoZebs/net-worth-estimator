import type { ReactNode } from "react";
import {
	SidebarInset,
	SidebarProvider,
	useSidebar,
} from "@/components/ui/sidebar.tsx";
import { NotificationCenter } from "../components/NotificationCenter.tsx";
import {
	BreadcrumbSlotProvider,
	useBreadcrumbSlotTarget,
} from "./breadcrumbSlot.tsx";
import { useHorizontalSwipe } from "./useHorizontalSwipe.ts";

/** Opens the existing mobile navigation sheet from a rightward swipe. The
 *  hook owns gesture arbitration; the sheet keeps Base UI modal behavior. */
function SidebarSwipeOpener() {
	const { isMobile, openMobile, setOpenMobile } = useSidebar();
	useHorizontalSwipe({
		enabled: isMobile && !openMobile,
		onSwipeRight: () => setOpenMobile(true),
	});
	return null;
}

function DesktopBreadcrumbSlot() {
	const slot = useBreadcrumbSlotTarget("atLeastMd");
	if (!slot) return null;
	return <div ref={slot} className="mb-2 empty:hidden print:hidden" />;
}

export function WorkspaceLayout({
	navigation,
	header,
	children,
}: {
	navigation: ReactNode;
	header: ReactNode;
	children: ReactNode;
}) {
	return (
		<BreadcrumbSlotProvider>
			<SidebarProvider>
				<SidebarSwipeOpener />
				<a
					className="fixed -top-20 left-60 z-(--z-skip) rounded-xl bg-primary px-5 py-3 text-primary-foreground focus:top-3 max-md:left-5"
					href="#main-content"
				>
					Skip to main content
				</a>
				{navigation}
				<SidebarInset>
					{header}
					<div
						id="main-content"
						className="mx-auto w-full max-w-7xl flex-1 px-5 py-6 sm:px-6 md:py-8 xl:px-8 print:p-0"
					>
						<DesktopBreadcrumbSlot />
						{children}
					</div>
					<NotificationCenter />
				</SidebarInset>
			</SidebarProvider>
		</BreadcrumbSlotProvider>
	);
}
