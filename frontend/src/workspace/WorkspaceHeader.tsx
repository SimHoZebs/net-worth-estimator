import { ArrowUpRight, Check, GitBranch, Menu } from "lucide-react";
import type { Ref } from "react";
import { IconButton } from "../components/ui.tsx";
import type { PageDefinition } from "./navigation.ts";

export function WorkspaceTopbar({
	label,
	example,
	loading,
	changeCount,
	serverMode,
	onOpenNavigation,
	onSources,
}: {
	label: string;
	example: boolean;
	loading: boolean;
	changeCount: number;
	serverMode: boolean;
	onOpenNavigation: () => void;
	onSources: () => void;
}) {
	return (
		<header className="topbar">
			<div className="breadcrumb">
				<IconButton
					icon={Menu}
					label="Open navigation"
					className="mobile-only"
					onClick={onOpenNavigation}
				/>
				<span className="desktop-only">Your household</span>
				<span className="breadcrumb-slash desktop-only">/</span>
				<strong>{label}</strong>
			</div>
			<div className="topbar-status">
				{example && (
					<button type="button" className="example-pill" onClick={onSources}>
						Example plan <ArrowUpRight size={12} />
					</button>
				)}
				{loading ? (
					<span className="saved-indicator">
						<span className="spinner" aria-hidden="true" />
						Updating server
					</span>
				) : (
					<span
						className={`saved-indicator ${changeCount ? "draft-indicator" : ""}`}
					>
						{changeCount ? <GitBranch size={14} /> : <Check size={14} />}
						{changeCount
							? "Temporary version"
							: serverMode
								? "Saved server plan"
								: "Saved plan"}
					</span>
				)}
				<span
					className="profile-avatar"
					role="img"
					aria-label="Household workspace"
				>
					H
				</span>
			</div>
		</header>
	);
}

export function WorkspaceHeading({
	page,
	headingRef,
	onTryChange,
}: {
	page: PageDefinition;
	headingRef: Ref<HTMLHeadingElement>;
	onTryChange: () => void;
}) {
	return (
		<div className="page-heading">
			<div>
				<div className="eyebrow">PLAN WITH PERSPECTIVE</div>
				<h1 ref={headingRef} tabIndex={-1}>
					{page.title}
				</h1>
				<p>{page.subtitle}</p>
			</div>
			{page.id !== "sources" && (
				<button
					type="button"
					className="button primary try-change"
					onClick={onTryChange}
				>
					<GitBranch size={17} />
					Try a change <ArrowUpRight size={16} />
				</button>
			)}
		</div>
	);
}
