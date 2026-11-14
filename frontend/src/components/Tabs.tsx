import { type ReactNode, useId } from "react";
import { mergeStyles } from "./mergeStyles.ts";
import {
	Tabs as ShadcnTabs,
	TabsList as ShadcnTabsList,
	TabsTrigger as ShadcnTabsTrigger,
} from "./ui/tabs.tsx";

export interface TabItem<T extends string> {
	id: T;
	label: string;
	count?: number | null;
}

/**
 * Underline tabs on the shadcn tabs primitive (line variant). The legacy
 * tab recipe stays the visual owner; flex-none, h-auto, font-normal,
 * hover:text-ink, after:hidden, and p-0 neutralize the primitive's
 * equal-width, fixed-height, and double-underline defaults. Nova focus rings
 * stay off so the global :focus-visible owner in typography.css paints the
 * single keyboard indicator. The shared panel keeps its wiring (one panel
 * for every tab, custom section support) outside the primitive.
 */
export function Tabs<T extends string>({
	items,
	value,
	onChange,
	label,
	className = "",
	panelClassName,
	panelAs: Panel = "div",
	children,
}: {
	items: readonly TabItem<T>[];
	value: T;
	onChange: (value: T) => void;
	label: string;
	className?: string;
	panelClassName?: string;
	panelAs?: "section" | "div";
	children: ReactNode;
}) {
	const id = useId();
	return (
		<ShadcnTabs value={value} className="gap-0">
			<ShadcnTabsList
				variant="line"
				aria-label={label}
				className={mergeStyles(
					"mb-6 flex w-full gap-6 overflow-x-auto border-0 border-b border-solid border-line p-0 max-sm:gap-5",
					className,
				)}
			>
				{items.map((item) => (
					<ShadcnTabsTrigger
						key={item.id}
						id={`${id}-${item.id}`}
						value={item.id}
						onClick={() => onChange(item.id)}
						onFocus={() => {
							if (item.id !== value) onChange(item.id);
						}}
						className={mergeStyles(
							"flex flex-none items-center gap-2 border-0 border-b-2 border-solid border-transparent bg-transparent px-0.5 pt-3 pb-4 text-sm font-normal whitespace-nowrap text-muted after:hidden hover:text-ink aria-selected:font-semibold aria-selected:text-ink",
							"h-auto focus-visible:outline-solid focus-visible:outline-3 focus-visible:outline-primary focus-visible:ring-0",
						)}
					>
						{item.label}
						{item.count != null && (
							<span className="min-w-5 rounded-control bg-active px-1 py-px text-xs text-success-text">
								{item.count}
							</span>
						)}
					</ShadcnTabsTrigger>
				))}
			</ShadcnTabsList>
			<Panel
				className={panelClassName}
				id={`${id}-panel`}
				role="tabpanel"
				aria-labelledby={`${id}-${value}`}
			>
				{children}
			</Panel>
		</ShadcnTabs>
	);
}
