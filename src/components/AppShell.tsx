import { type ReactNode, useEffect, useRef } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { useShallow } from "zustand/shallow";
import { Button } from "@/components/ui/button";
import { useModelRuntime } from "@/runtime/modelRuntime";
import { selectCurrentChangeCount, useStore } from "@/store";
import { useThemeStore } from "@/themeStore";

interface AppShellProps {
	children: ReactNode;
}

// Order matches the primary task flow: review results, edit accounts,
// analyze, configure.
const routes = [
	{ to: "/", label: "Results", end: true },
	{ to: "/analysis", label: "Analysis", end: false },
	{ to: "/settings", label: "Settings", end: false },
	{ to: "/accounts", label: "Accounts", end: false },
];

const MAIN_CONTENT_ID = "main-content";

/**
 * Reset scroll and move programmatic focus to the content wrapper on route
 * change so keyboard and screen-reader users land at the start of the new
 * page. Pages own their own <main> landmark, so the shell exposes a
 * focusable wrapper carrying the skip-link target id instead.
 */
function useRouteFocusReset(targetId: string) {
	const { pathname } = useLocation();
	const isFirstRender = useRef(true);
	// biome-ignore lint/correctness/useExhaustiveDependencies: pathname intentionally re-runs the reset on route change without being read.
	useEffect(() => {
		if (isFirstRender.current) {
			isFirstRender.current = false;
			return;
		}
		try {
			window.scrollTo({ top: 0, behavior: "auto" });
		} catch {
			// Scroll options are unavailable in some test environments.
		}
		document.getElementById(targetId)?.focus({ preventScroll: true });
	}, [pathname, targetId]);
}

function SunIcon() {
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
			<circle cx="12" cy="12" r="4" />
			<path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
		</svg>
	);
}

function MoonIcon() {
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
			<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
		</svg>
	);
}

function ThemeToggle() {
	const resolvedTheme = useThemeStore((state) => state.resolvedTheme);
	const setTheme = useThemeStore((state) => state.setTheme);
	const isDark = resolvedTheme === "dark";
	return (
		<Button
			variant="outline"
			size="icon"
			type="button"
			aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
			aria-pressed={isDark}
			onClick={() => setTheme(isDark ? "light" : "dark")}
		>
			{isDark ? <SunIcon /> : <MoonIcon />}
		</Button>
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
	useRouteFocusReset(MAIN_CONTENT_ID);

	const statusBlock = (
		<div className="min-w-0">
			<div className="type-eyebrow text-primary">Net worth estimator</div>
			<div className="mt-1 truncate type-caption">
				{document ? (
					<span>
						Baseline loaded from{" "}
						<span className="font-medium text-foreground/75">
							{source.label}
						</span>
						{currentChangeCount > 0
							? ` · ${currentChangeCount} unsaved change${currentChangeCount === 1 ? "" : "s"}`
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

	// A single nav landmark restyled per breakpoint: bottom tab bar on small
	// screens, sidebar list on desktop. One link set keeps DOM order, tab
	// order, and screen-reader output identical everywhere. React Router's
	// NavLink reports aria-current="page" for the active route.
	const navLinks = (
		<ul className="flex items-stretch gap-1 lg:flex-col">
			{routes.map((route) => (
				<li key={route.to} className="min-w-0 flex-1 lg:flex-none">
					<NavLink
						to={route.to}
						end={route.end}
						className={({ isActive }) =>
							`flex min-h-[44px] flex-1 items-center justify-center rounded-xl px-2 py-2 text-center text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:w-full lg:justify-start lg:px-4 ${
								isActive
									? "bg-primary text-primary-foreground shadow-sm"
									: "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
							}`
						}
					>
						{route.label}
					</NavLink>
				</li>
			))}
		</ul>
	);

	return (
		<div className="app-shell min-h-screen bg-background text-foreground">
			<a href={`#${MAIN_CONTENT_ID}`} className="skip-link">
				Skip to main content
			</a>
			<header className="no-print sticky top-0 z-40 border-b border-border/70 bg-card/72 backdrop-blur-xl lg:hidden dark:border-white/10">
				<div className="flex items-center justify-between gap-3 px-4 py-3 md:px-8">
					<div className="min-w-0 flex-1">{statusBlock}</div>
					<div className="flex shrink-0 items-center gap-2">
						<ThemeToggle />
					</div>
				</div>
			</header>

			<div className="mx-auto flex max-w-[var(--content-max-width)] flex-col lg:flex-row">
				<div className="no-print fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-card/90 backdrop-blur-xl lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-64 lg:shrink-0 lg:border-t-0 lg:border-r lg:bg-card/72 dark:border-white/10">
					<div className="flex items-center gap-2 px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] lg:h-full lg:flex-col lg:items-stretch lg:gap-5 lg:px-5 lg:py-8">
						<div className="hidden min-w-0 lg:block">{statusBlock}</div>
						<nav
							aria-label="Primary navigation"
							className="min-w-0 flex-1 lg:flex-none"
						>
							{navLinks}
						</nav>
						<div className="hidden shrink-0 lg:mt-auto lg:block">
							<ThemeToggle />
						</div>
					</div>
				</div>

				<div
					id={MAIN_CONTENT_ID}
					tabIndex={-1}
					className="min-w-0 flex-1 px-4 pt-6 pb-28 outline-none md:px-8 lg:pb-12"
				>
					{children}
				</div>
			</div>
		</div>
	);
}
