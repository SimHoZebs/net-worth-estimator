import { Link } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen, Settings } from "lucide-react";
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
	useSidebar,
} from "@/components/ui/sidebar.tsx";
import { useServerStatus } from "../state/workspaceResources.ts";
import { useInboxUnreadCount } from "../state/inbox.ts";
import { LastSync } from "./LastSync.tsx";
import { pagePaths, pages, type Page } from "./navigation.ts";

function WorkspaceNavLink({
	to,
	active,
	label,
	accessibleName = label,
	tooltip = label,
	children,
}: {
	to: (typeof pagePaths)[Page];
	active: boolean;
	label: string;
	accessibleName?: string;
	tooltip?: string;
	children: ReactNode;
}) {
	const { setOpenMobile } = useSidebar();
	return (
		<SidebarMenuButton
			isActive={active}
			size="lg"
			tooltip={tooltip}
			aria-label={accessibleName}
			aria-current={active ? "page" : undefined}
			className="h-12 text-base group-data-[collapsible=icon]:justify-center [&>svg]:size-5"
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
	const inboxAccessibleName =
		unreadCount > 0 ? `Inbox, ${unreadCount} unread` : "Inbox";
	const { open, setOpen, setOpenMobile } = useSidebar();
	const navigationToggleLabel = open ? "Close navigation" : "Open navigation";
	return (
		<Sidebar collapsible="icon" className="print:hidden">
			<SidebarHeader>
				<div className="flex items-center justify-between gap-2">
					<div className="group-data-[collapsible=icon]:hidden">
						<Brand />
					</div>
					<SidebarMenuButton
						size="default"
						tooltip={navigationToggleLabel}
						aria-label={navigationToggleLabel}
						aria-expanded={open}
						className="hidden shrink-0 md:flex md:w-auto"
						onClick={() => setOpen(!open)}
					>
						{open ? (
							<PanelLeftClose aria-hidden="true" />
						) : (
							<PanelLeftOpen aria-hidden="true" />
						)}
					</SidebarMenuButton>
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
				<SidebarGroup className="group-data-[collapsible=icon]:px-0">
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
												label={item.label}
												accessibleName={
													item.id === "inbox" ? inboxAccessibleName : undefined
												}
												tooltip={
													item.id === "inbox" ? inboxAccessibleName : undefined
												}
											>
												<item.icon aria-hidden="true" />
												<span className="group-data-[collapsible=icon]:hidden">
													{item.label}
												</span>
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
			<SidebarFooter className="group-data-[collapsible=icon]:px-0">
				<SidebarMenu>
					<SidebarMenuItem>
						<WorkspaceNavLink
							to={pagePaths.sources}
							active={page === "sources"}
							label="Configs"
						>
							<Settings aria-hidden="true" />
							<span className="group-data-[collapsible=icon]:hidden">
								Configs
							</span>
						</WorkspaceNavLink>
					</SidebarMenuItem>
				</SidebarMenu>
				<ThemeToggle />
				<div className="px-2 pt-1 pb-2 text-xs leading-relaxed text-muted-foreground group-data-[collapsible=icon]:hidden">
					{pending ? (
						<Skeleton className="h-3 w-28" />
					) : (
						<LastSync status={status ?? null} />
					)}
				</div>
			</SidebarFooter>
		</Sidebar>
	);
}
