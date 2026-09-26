import {
	ArrowUpRight,
	ChevronDown,
	CircleHelp,
	HardDrive,
	LockKeyhole,
	PanelLeftClose,
	ShieldCheck,
} from "lucide-react";
import { Brand } from "../components/Brand.tsx";
import { IconButton } from "../components/ui.tsx";
import { type Page, pages } from "./navigation.ts";

export function WorkspaceSidebar({
	page,
	planName,
	changeCount,
	serverMode,
	statusLabel,
	onNavigate,
	onMethod,
	onClose,
}: {
	page: Page;
	planName: string;
	changeCount: number;
	serverMode: boolean;
	statusLabel: string;
	onNavigate: (page: Page) => void;
	onMethod: () => void;
	onClose: () => void;
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
					<strong>{planName}</strong>
					<small>
						{serverMode ? "Server household" : "Personal workspace"}
					</small>
				</span>
				<ChevronDown size={14} />
			</button>
			<span className="nav-label">YOUR BIG PICTURE</span>
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
				<div className="local-card">
					<span className="local-icon">
						<ShieldCheck size={20} strokeWidth={1.5} />
					</span>
					<strong>A little more peace of mind.</strong>
					<p>
						{serverMode
							? "Your canonical server model lives on the server. Temporary edits stay in this browser until you save."
							: "Your plan stays on this device. Your decisions stay yours."}
					</p>
					<button type="button" className="text-button" onClick={onMethod}>
						How it works <ArrowUpRight size={14} />
					</button>
				</div>
				{/* biome-ignore lint/a11y/useValidAnchor: The hash navigates to a workspace page; onClick only closes the mobile drawer. */}
				<a
					className={`nav-link ${page === "sources" ? "active" : ""}`}
					href="#sources"
					onClick={onClose}
					aria-current={page === "sources" ? "page" : undefined}
				>
					<HardDrive size={19} strokeWidth={1.7} />
					<span>Data & sources</span>
				</a>
				<button type="button" className="nav-link help-link" onClick={onMethod}>
					<CircleHelp size={19} strokeWidth={1.7} />
					<span>A guide to your outlook</span>
				</button>
				<div className="sidebar-status">
					<span className="status-dot" />
					{statusLabel} <LockKeyhole size={12} />
				</div>
			</div>
		</>
	);
}
