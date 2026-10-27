import { PanelLeftClose, Settings } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { Brand } from "../components/Brand.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { IconButton } from "../components/Button.tsx";
import { Skeleton } from "../components/Skeleton.tsx";
import { mergeStyles } from "../components/mergeStyles.ts";
import { useServerStatus } from "../state/workspaceResources.ts";
import { LastSync } from "./LastSync.tsx";
import { type Page, pages } from "./navigation.ts";
import {
	navigationActiveSquareClassName,
	navigationLinkClassName,
} from "./navigationStyles.ts";

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
	const reduceMotion = useReducedMotion();
	return (
		<a
			className={mergeStyles(
				navigationLinkClassName,
				reduceMotion && active ? "bg-active" : undefined,
			)}
			href={href}
			onClick={onClose}
			aria-current={active ? "page" : undefined}
		>
			{active && !reduceMotion && (
				<motion.span
					layoutId="workspace-nav-active"
					aria-hidden="true"
					className={navigationActiveSquareClassName}
					initial={false}
					transition={{ type: "spring", stiffness: 550, damping: 40 }}
				/>
			)}
			{/* Content stays above the pill: the pill is owned by the newly
				active link, so while it travels it overlaps sibling rows. A
				positive z-index keeps every row's text above it for the whole
				flight; without this the pill covers the previous tab's text on
				its way out. */}
			<span className="relative z-10 flex min-w-0 items-center gap-3">
				{children}
			</span>
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
	// Plan display values subscribe here so navigation never waits on props.
	const status = useServerStatus().data;
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
