import { type ReactNode, useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import { useShallow } from "zustand/shallow";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { selectCurrentChangeCount, useStore } from "@/store";

interface AppShellProps {
	children: ReactNode;
}

const routes = [
	{ to: "/", label: "Results", end: true },
	{ to: "/analysis", label: "Analysis", end: false },
	{ to: "/settings", label: "Settings", end: false },
	{ to: "/model-inputs", label: "Model inputs", end: false },
];

function MenuIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			className="size-4"
			aria-hidden="true"
		>
			<path d="M4 6h16M4 12h16M4 18h16" />
		</svg>
	);
}

function CloseIcon() {
	return (
		<svg
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2"
			strokeLinecap="round"
			className="size-4"
			aria-hidden="true"
		>
			<path d="M6 6l12 12M18 6L6 18" />
		</svg>
	);
}

export function AppShell({ children }: AppShellProps) {
	const { source, document, isLoading, loadError } = useModelRuntime();
	const { currentChangeCount, isEditing, isDirty } = useStore(
		useShallow((state) => ({
			currentChangeCount: selectCurrentChangeCount(state),
			isEditing: state.isEditing,
			isDirty: state.isDirty,
		})),
	);
	const [isNavOpen, setIsNavOpen] = useState(false);

	useEffect(() => {
		if (!isNavOpen) return;
		const desktop = window.matchMedia("(min-width: 64rem)");
		const handleChange = () => {
			if (desktop.matches) setIsNavOpen(false);
		};
		desktop.addEventListener("change", handleChange);
		return () => desktop.removeEventListener("change", handleChange);
	}, [isNavOpen]);

	const statusBlock = (
		<div>
			<div className="type-eyebrow text-primary">Net worth estimator</div>
			<div className="mt-1 type-caption">
				{document ? (
					<span>
						Baseline loaded from{" "}
						<span className="font-medium text-foreground/75">
							{source.label}
						</span>
						{currentChangeCount > 0
							? ` · ${currentChangeCount} temporary change${currentChangeCount === 1 ? "" : "s"}`
							: ""}
						{isEditing && isDirty ? " · Unsaved baseline edits" : ""}
						{isEditing && !isDirty ? " · Editing baseline" : ""}
					</span>
				) : loadError ? (
					<span className="text-destructive">
						Financial model failed to load
					</span>
				) : isLoading ? (
					<span className="inline-flex items-center gap-2">
						<span className="inline-block h-2 w-2 animate-pulse rounded-full bg-primary/70" />
						Loading financial model...
					</span>
				) : (
					<span>No financial model loaded</span>
				)}
			</div>
		</div>
	);

	const navLinks = (onNavigate?: () => void) =>
		routes.map((route) => (
			<NavLink
				key={route.to}
				to={route.to}
				end={route.end}
				onClick={onNavigate}
				className={({ isActive }) =>
					`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full ${
						isActive
							? "bg-primary text-primary-foreground shadow-sm"
							: "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
					}`
				}
			>
				{route.label}
			</NavLink>
		));

	return (
		<div className="app-shell min-h-screen bg-background text-foreground">
			<header className="no-print border-b border-border/70 bg-card/72 backdrop-blur-xl dark:border-white/10 lg:hidden">
				<div className="flex items-start justify-between gap-4 px-4 py-4 md:px-8">
					{statusBlock}
					<Button
						variant="outline"
						size="icon"
						aria-label="Open navigation menu"
						aria-haspopup="dialog"
						aria-expanded={isNavOpen}
						onClick={() => setIsNavOpen(true)}
					>
						<MenuIcon />
					</Button>
				</div>
			</header>

			<div className="mx-auto flex max-w-[106rem] flex-col lg:flex-row">
				<aside className="no-print hidden shrink-0 border-border/70 bg-card/72 backdrop-blur-xl dark:border-white/10 lg:sticky lg:top-0 lg:block lg:h-screen lg:w-64 lg:border-r">
					<div className="flex h-full flex-col gap-5 px-5 py-8">
						{statusBlock}
						<nav
							aria-label="Primary navigation"
							className="flex flex-col gap-1 rounded-2xl border border-border/70 bg-surface/70 p-1 shadow-sm dark:border-white/10"
						>
							{navLinks()}
						</nav>
					</div>
				</aside>

				<div className="min-w-0 flex-1 px-4 py-6 md:px-8">{children}</div>
			</div>

			{isNavOpen ? (
				<Dialog
					ariaLabel="Navigation menu"
					onClose={() => setIsNavOpen(false)}
					overlayClassName="no-print items-stretch justify-start p-0 lg:hidden"
					className="drawer-panel h-full max-h-full w-72 max-w-[85vw] rounded-none border-l-0 border-y-0 bg-card/95 shadow-2xl backdrop-blur-xl"
				>
					<div className="flex h-full flex-col gap-5 p-5">
						<div className="flex items-start justify-between gap-4">
							{statusBlock}
							<Button
								variant="ghost"
								size="icon"
								aria-label="Close navigation menu"
								onClick={() => setIsNavOpen(false)}
							>
								<CloseIcon />
							</Button>
						</div>
						<nav
							aria-label="Primary navigation"
							className="flex flex-col gap-1 rounded-2xl border border-border/70 bg-surface/70 p-1 shadow-sm dark:border-white/10"
						>
							{navLinks(() => setIsNavOpen(false))}
						</nav>
					</div>
				</Dialog>
			) : null}
		</div>
	);
}
