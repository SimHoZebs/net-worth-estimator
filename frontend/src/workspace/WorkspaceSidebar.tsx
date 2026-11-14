import { Link } from "@tanstack/react-router";
import { PanelLeftClose, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { Brand } from "../components/Brand.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import {
	Sidebar,
	SidebarContent,
	SidebarFooter,
	SidebarGroup,
	SidebarGroupContent,
	SidebarHeader,
	SidebarMenu,
	SidebarMenuBadge,
	SidebarMenuButton,
	SidebarMenuItem,
	SidebarRail,
	useSidebar,
} from "@/components/ui/sidebar.tsx";
import { useServerStatus } from "../state/workspaceResources.ts";
import { useInboxUnreadCount } from "../state/inbox.ts";
import { LastSync } from "./LastSync.tsx";
import { pagePaths, pages, type Page } from "./navigation.ts";

function WorkspaceNavLink({
	to,
	active,
	children,
}: {
	to: (typeof pagePaths)[Page];
	active: boolean;
	children: ReactNode;
}) {
	const { setOpenMobile } = useSidebar();
	return (
		<SidebarMenuButton
			isActive={active}
			onClick={(event) => {
				// Plain clicks close the mobile sheet; modifier and middle
				// clicks keep the native new-tab behavior.
				if (
					event.metaKey ||
					event.ctrlKey ||
					event.shiftKey ||
					event.altKey ||
					event.button !== 0
				) {
					return;
				}
				setOpenMobile(false);
			}}
			render={<Link to={to} preload="intent" />}
		>
			{children}
		</SidebarMenuButton>
	);
}

export function WorkspaceSidebar({
	page,
	pending = false,
}: {
	page: Page | null;
	pending?: boolean;
}) {
	// Saved data subscribes here so navigation never waits on props.
	const status = useServerStatus().data;
	// The inbox badge reflects persisted unread state; a failed load hides
	// the badge instead of blocking navigation.
	const unreadCount = useInboxUnreadCount().data ?? 0;
	const { setOpenMobile } = useSidebar();
	return (
		<Sidebar className="print:hidden">
			<SidebarHeader>
				<div className="flex items-center justify-between">
					<Brand />
					<Button
						variant="ghost"
						size="icon-sm"
						aria-label="Close navigation"
						title="Close navigation"
						className="md:hidden"
						onClick={() => setOpenMobile(false)}
					>
						<PanelLeftClose aria-hidden="true" />
					</Button>
				</div>
			</SidebarHeader>
			<SidebarContent>
				<SidebarGroup>
					<SidebarGroupContent>
						<nav aria-label="Main navigation">
							<SidebarMenu>
								{pages
									.filter((item) => item.id !== "sources")
									.map((item) => (
										<SidebarMenuItem key={item.id}>
											<WorkspaceNavLink
												to={pagePaths[item.id]}
												active={page === item.id}
											>
												<item.icon aria-hidden="true" />
												<span>{item.label}</span>
											</WorkspaceNavLink>
											{item.id === "inbox" && unreadCount > 0 && (
												<SidebarMenuBadge aria-label={`${unreadCount} unread`}>
													{unreadCount}
												</SidebarMenuBadge>
											)}
										</SidebarMenuItem>
									))}
							</SidebarMenu>
						</nav>
					</SidebarGroupContent>
				</SidebarGroup>
			</SidebarContent>
			<SidebarFooter>
				<SidebarMenu>
					<SidebarMenuItem>
						<WorkspaceNavLink
							to={pagePaths.sources}
							active={page === "sources"}
						>
							<Settings aria-hidden="true" />
							<span>Configs</span>
						</WorkspaceNavLink>
					</SidebarMenuItem>
				</SidebarMenu>
				<ThemeToggle />
				<div className="px-2 pt-1 pb-2 text-xs leading-relaxed text-muted-foreground">
					{pending ? (
						<Skeleton className="h-3 w-28" />
					) : (
						<LastSync status={status ?? null} />
					)}
				</div>
			</SidebarFooter>
			<SidebarRail />
		</Sidebar>
	);
}
