import {
	ChevronDown,
	CircleHelp,
	LockKeyhole,
	PanelLeftClose,
	Settings,
} from "lucide-react";
import { Brand } from "../components/Brand.tsx";
import { ThemeToggle } from "../components/ThemeToggle.tsx";
import { IconButton } from "../components/ui.tsx";
import { type Page, pages } from "./navigation.ts";

export function WorkspaceSidebar({
	page,
	planName,
	changeCount,
	statusLabel,
	onNavigate,
	onMethod,
	onClose,
	pending = false,
}: {
	page: Page;
	planName: string;
	changeCount: number;
	statusLabel: string;
	onNavigate: (page: Page) => void;
	onMethod: () => void;
	onClose: () => void;
	pending?: boolean;
}) {
	return (
		<>
			<div className="brand-row">
				<Brand />
				<IconButton
					icon={PanelLeftClose}
					label="Close navigation"
					className="mobile-only"
					onClick={onClose}
				/>
			</div>
			<button
				type="button"
				className="household-select"
				onClick={() => {
					onNavigate("sources");
					onClose();
				}}
			>
				<span className="household-avatar">H</span>
				<span>
					{pending ? (
						<span
							className="skeleton"
							style={{ width: 110, height: 14 }}
							aria-hidden="true"
						/>
					) : (
						<strong>{planName}</strong>
					)}
				</span>
				<ChevronDown size={14} />
			</button>
			<nav aria-label="Main navigation">
				<ul>
					{pages
						.filter((item) => item.id !== "sources")
						.map((item) => (
							<li key={item.id}>
								<a
									className={page === item.id ? "nav-link active" : "nav-link"}
									href={`#${item.id}`}
									onClick={onClose}
									aria-current={page === item.id ? "page" : undefined}
								>
									<item.icon size={19} strokeWidth={1.7} />
									<span>{item.label}</span>
									{item.id === "compare" && changeCount > 0 && (
										<span className="nav-count">{changeCount}</span>
									)}
								</a>
							</li>
						))}
				</ul>
			</nav>
			<div className="sidebar-bottom">
				{/* biome-ignore lint/a11y/useValidAnchor: The hash navigates to a workspace page; onClick only closes the mobile drawer. */}
				<a
					className={`nav-link ${page === "sources" ? "active" : ""}`}
					href="#sources"
					onClick={onClose}
					aria-current={page === "sources" ? "page" : undefined}
				>
					<Settings size={19} strokeWidth={1.7} />
					<span>Configs</span>
				</a>
				<button
					type="button"
					className="nav-link help-link"
					onClick={onMethod}
					disabled={pending}
				>
					<CircleHelp size={19} strokeWidth={1.7} />
					<span>How it works</span>
				</button>
				<ThemeToggle />
				<div className="sidebar-status">
					<span className="status-dot" />
					{pending ? (
						<span
							className="skeleton"
							style={{ width: 80, height: 10 }}
							aria-hidden="true"
						/>
					) : (
						<>
							{statusLabel} <LockKeyhole size={12} />
						</>
					)}
				</div>
			</div>
		</>
	);
}
