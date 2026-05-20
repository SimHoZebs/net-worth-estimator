import {
	createContext,
	type ReactNode,
	useContext,
	useEffect,
	useRef,
	useState,
} from "react";

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
}

function CollapsibleRoot({
	children,
	defaultOpen = false,
	autoOpenWhen = false,
	open: controlledOpen,
	onOpenChange,
	className = "",
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
				className={`rounded-[1.8rem] border border-border bg-card px-5 py-5 shadow-sm open:border-ring ${className}`}
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
			className={`group cursor-pointer list-none select-none ${className}`}
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
	return <div className={`mt-5 ${className}`}>{children}</div>;
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
			className={`shrink-0 text-muted-foreground/70 transition-transform duration-200 ${open ? "rotate-180" : ""} ${className}`}
		>
			<polyline points="6 9 12 15 18 9" />
		</svg>
	);
}

export const Collapsible = Object.assign(CollapsibleRoot, {
	Trigger: CollapsibleTrigger,
	Content: CollapsibleContent,
	Chevron: CollapsibleChevron,
});
