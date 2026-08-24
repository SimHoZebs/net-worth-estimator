import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";
import { cn } from "@/lib/utils";

const ROOT_BASE_CLASS =
	"rounded-[1.8rem] border border-border/80 bg-card/88 px-5 py-5 shadow-[0_16px_48px_color-mix(in_oklab,var(--foreground)_8%,transparent)] backdrop-blur-sm transition-colors open:border-ring/70 dark:border-white/10 dark:bg-card/82 dark:shadow-[0_18px_60px_rgba(0,0,0,0.32)]";

interface CollapsibleContextValue {
	open: boolean;
	onToggle: () => void;
}

const CollapsibleContext = createContext<CollapsibleContextValue | null>(null);

function useCollapsible() {
	const ctx = useContext(CollapsibleContext);
	if (!ctx) {
		throw new Error(
			"Collapsible compound components must be used within <Collapsible>",
		);
	}
	return ctx;
}

/* ── Root ── */

interface CollapsibleRootProps {
	children: ReactNode;
	defaultOpen?: boolean;
	autoOpenWhen?: boolean;
	open?: boolean;
	onOpenChange?: (open: boolean) => void;
	className?: string;
	unstyled?: boolean;
}

function CollapsibleRoot({
	children,
	defaultOpen = false,
	autoOpenWhen = false,
	open: controlledOpen,
	onOpenChange,
	className = "",
	unstyled = false,
}: CollapsibleRootProps) {
	const isControlled = controlledOpen !== undefined;
	const [internalOpen, setInternalOpen] = useState(defaultOpen || autoOpenWhen);
	const prevAutoOpenWhenRef = useRef(autoOpenWhen);

	useEffect(() => {
		if (!isControlled && autoOpenWhen && !prevAutoOpenWhenRef.current) {
			setInternalOpen(true);
		}
		prevAutoOpenWhenRef.current = autoOpenWhen;
	}, [autoOpenWhen, isControlled]);

	const isOpen = isControlled ? controlledOpen : internalOpen;

	const toggle = () => {
		const next = !isOpen;
		if (isControlled) {
			onOpenChange?.(next);
		} else {
			setInternalOpen(next);
		}
	};

	return (
		<CollapsibleContext.Provider value={{ open: isOpen, onToggle: toggle }}>
			<details
				open={isOpen}
				className={cn(unstyled ? null : ROOT_BASE_CLASS, className)}
			>
				{children}
			</details>
		</CollapsibleContext.Provider>
	);
}

/* ── Trigger ── */

interface CollapsibleTriggerProps {
	children: ReactNode;
	className?: string;
}

function CollapsibleTrigger({
	children,
	className = "",
}: CollapsibleTriggerProps) {
	const { onToggle } = useCollapsible();
	return (
		<summary
			className={cn("group cursor-pointer list-none select-none", className)}
			onClick={(e) => {
				e.preventDefault();
				onToggle();
			}}
		>
			{children}
		</summary>
	);
}

/* ── Content ── */

interface CollapsibleContentProps {
	children: ReactNode;
	className?: string;
}

function CollapsibleContent({
	children,
	className = "",
}: CollapsibleContentProps) {
	return <div className={cn("mt-5", className)}>{children}</div>;
}

/* ── Chevron ── */

interface CollapsibleChevronProps {
	className?: string;
}

function CollapsibleChevron({ className = "" }: CollapsibleChevronProps) {
	const { open } = useCollapsible();
	return (
		<svg
			aria-hidden="true"
			xmlns="http://www.w3.org/2000/svg"
			width="16"
			height="16"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="2.5"
			strokeLinecap="round"
			strokeLinejoin="round"
			className={cn(
				"shrink-0 text-muted-foreground/70 transition-transform duration-200",
				open ? "rotate-180" : "",
				className,
			)}
		>
			<polyline points="6 9 12 15 18 9" />
		</svg>
	);
}

/* ── Header ── */

interface CollapsibleHeaderProps {
	title: ReactNode;
	description?: ReactNode;
	trailing?: ReactNode;
}

// Shared trigger content: chevron, title/description block, and an optional
// trailing slot (status pills or a "Show details" hint).
function CollapsibleHeader({
	title,
	description,
	trailing,
}: CollapsibleHeaderProps) {
	return (
		<div className="flex items-start justify-between gap-4">
			<div className="flex items-start gap-3">
				<CollapsibleChevron />
				<div>
					<div className="type-title text-base">{title}</div>
					{description ? <div className="type-muted">{description}</div> : null}
				</div>
			</div>
			{trailing}
		</div>
	);
}

export const Collapsible = Object.assign(CollapsibleRoot, {
	Trigger: CollapsibleTrigger,
	Content: CollapsibleContent,
	Chevron: CollapsibleChevron,
	Header: CollapsibleHeader,
});
