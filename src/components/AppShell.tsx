import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useShallow } from "zustand/shallow";
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

export function AppShell({ children }: AppShellProps) {
	const { source, document, isLoading, loadError } = useModelRuntime();
	const { currentChangeCount, isEditing, isDirty } = useStore(
		useShallow((state) => ({
			currentChangeCount: selectCurrentChangeCount(state),
			isEditing: state.isEditing,
			isDirty: state.isDirty,
		})),
	);
	return (
		<div className="app-shell min-h-screen bg-background text-foreground">
			<header className="border-b border-border/70 bg-card/72 backdrop-blur-xl dark:border-white/10 no-print">
				<div className="mx-auto flex max-w-[106rem] flex-col gap-4 px-4 py-4 md:px-8 lg:flex-row lg:items-center lg:justify-between">
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

					<nav
						aria-label="Primary navigation"
						className="flex gap-1 overflow-x-auto rounded-2xl border border-border/70 bg-surface/70 p-1 shadow-sm dark:border-white/10"
					>
						{routes.map((route) => (
							<NavLink
								key={route.to}
								to={route.to}
								end={route.end}
								className={({ isActive }) =>
									`shrink-0 rounded-xl px-4 py-2 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
										isActive
											? "bg-primary text-primary-foreground shadow-sm"
											: "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
									}`
								}
							>
								{route.label}
							</NavLink>
						))}
					</nav>
				</div>
			</header>
			<div className="mx-auto max-w-[106rem] px-4 py-6 md:px-8">{children}</div>
		</div>
	);
}
