import { PanelLeftClose, Settings } from "lucide-react";
import type { ReactNode } from "react";
import { Brand } from "../components/Brand.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { IconButton } from "../components/Button.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { mergeStyles } from "../components/mergeStyles.ts";
import { useServerStatus } from "../state/workspaceResources.ts";
import { useInboxUnreadCount } from "../state/inbox.ts";
import { LastSync } from "./LastSync.tsx";
import { type Page, pages } from "./navigation.ts";
import { navigationLinkClassName } from "./navigationStyles.ts";

function SidebarNavLink({
	href,
	active,
	onClose,
	children,
}: {
	href: string;
	active: boolean;
	onClose: () => void;
	children: ReactNode;
}) {
	return (
		<a
			className={mergeStyles(
				navigationLinkClassName,
				active ? "bg-active" : undefined,
			)}
			href={href}
			onClick={onClose}
			aria-current={active ? "page" : undefined}
		>
			<span className="flex min-w-0 items-center gap-3">{children}</span>
		</a>
	);
}

export function WorkspaceSidebar({
	page,
	onClose,
	pending = false,
}: {
	page: Page;
	onClose: () => void;
	pending?: boolean;
}) {
	// Saved data subscribes here so navigation never waits on props.
	const status = useServerStatus().data;
	// The inbox badge reflects persisted unread state; a failed load hides
	// the badge instead of blocking navigation.
	const unreadCount = useInboxUnreadCount().data ?? 0;
	return (
		<>
			<div className="flex items-center justify-between px-2">
				<Brand />
				<IconButton
					icon={PanelLeftClose}
					label="Close navigation"
					className="hidden max-md:inline-grid"
					onClick={onClose}
				/>
			</div>
			<div className="mt-12">
				<nav aria-label="Main navigation">
					<ul className="grid list-none gap-1 p-0">
						{pages
							.filter((item) => item.id !== "sources")
							.map((item) => (
								<li key={item.id}>
									<SidebarNavLink
										href={`#${item.id}`}
										onClose={onClose}
										active={page === item.id}
									>
										<item.icon size={19} strokeWidth={1.7} />
										<span>
											{item.id === "purchases" ? (
												// Always two lines: the bold active weight is wider and
												// would otherwise reflow this row on selection. The
												// break keeps its accessible name ("Planned purchases")
												// so document title, header, and link queries are
												// unchanged.
												<>
													Planned
													<br />
													purchases
												</>
											) : (
												item.label
											)}
										</span>
										{item.id === "inbox" && unreadCount > 0 && (
											<span
												aria-label={`${unreadCount} unread`}
												className="min-w-5 rounded-control bg-active px-1 py-px text-center text-xs"
											>
												{unreadCount}
											</span>
										)}
									</SidebarNavLink>
								</li>
							))}
					</ul>
				</nav>
			</div>
			<div className="mt-auto pt-12 max-md:pt-8">
				<SidebarNavLink
					href="#sources"
					onClose={onClose}
					active={page === "sources"}
				>
					<Settings size={19} strokeWidth={1.7} />
					<span>Configs</span>
				</SidebarNavLink>
				<ThemeToggle />
				<div className="mt-4 border-0 border-t border-solid border-line pt-3 pb-4 text-xs leading-relaxed text-muted">
					{pending ? (
						<Skeleton className="h-3 w-28" />
					) : (
						<LastSync status={status ?? null} />
					)}
				</div>
			</div>
		</>
	);
}
