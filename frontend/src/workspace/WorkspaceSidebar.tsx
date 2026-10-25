import { LockKeyhole, PanelLeftClose, Settings } from "lucide-react";
import { SessionAccountControl } from "../auth/SessionAccountControl.tsx";
import { Brand } from "../components/Brand.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { IconButton, Skeleton } from "../components/ui.tsx";
import { useWorkspaceStore, selectPlan } from "../state/workspaceStore.ts";
import { LastSync } from "./LastSync.tsx";
import { type Page, pages } from "./navigation.ts";
import { navigationLinkClassName } from "./navigationStyles.ts";
import { workspaceStatusLabel } from "./WorkspaceNotices.tsx";

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
	const plan = useWorkspaceStore(selectPlan);
	const status = useWorkspaceStore((state) => state.status);
	const statusReadOnly = status?.readOnly ?? false;
	const writeBlocked = useWorkspaceStore((state) => state.writeBlocked);
	const readOnly =
		statusReadOnly ||
		writeBlocked ||
		(plan?.readOnly ?? status?.readOnly ?? true);
	const statusLabel = workspaceStatusLabel({ readOnly });
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
				<SessionAccountControl />
				<nav aria-label="Main navigation">
					<ul className="grid list-none gap-1 p-0">
						{pages
							.filter((item) => item.id !== "sources" && item.id !== "account")
							.map((item) => (
								<li key={item.id}>
									<a
										className={navigationLinkClassName}
										href={`#${item.id}`}
										onClick={onClose}
										aria-current={page === item.id ? "page" : undefined}
									>
										<item.icon size={19} strokeWidth={1.7} />
										<span>{item.label}</span>
									</a>
								</li>
							))}
					</ul>
				</nav>
			</div>
			<div className="mt-auto pt-12 max-md:pt-8">
				<a
					className={navigationLinkClassName}
					href="#sources"
					onClick={onClose}
					aria-current={page === "sources" ? "page" : undefined}
				>
					<Settings size={19} strokeWidth={1.7} />
					<span>Configs</span>
				</a>
				<ThemeToggle />
				<div className="mt-4 flex items-center gap-2 border-0 border-t border-solid border-line px-2 pt-5 pb-1 text-xs text-muted">
					<span className="size-1.5 rounded-full bg-primary" />
					{pending ? (
						<Skeleton className="h-3 w-20" />
					) : (
						<>
							{statusLabel} <LockKeyhole size={12} className="ml-auto" />
						</>
					)}
				</div>
				<div className="px-2 pb-5 text-xs leading-relaxed text-muted">
					{pending ? (
						<Skeleton className="h-3 w-28" />
					) : (
						<LastSync status={status} />
					)}
				</div>
			</div>
		</>
	);
}
