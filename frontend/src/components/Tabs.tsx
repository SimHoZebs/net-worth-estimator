import { type ReactNode, useId } from "react";
import { mergeStyles } from "./mergeStyles.ts";

export interface TabItem<T extends string> {
	id: T;
	label: string;
	count?: number | null;
}

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
		<>
			<div
				className={mergeStyles(
					"mb-6 flex gap-6 overflow-x-auto border-0 border-b border-solid border-line max-sm:gap-5",
					className,
				)}
				role="tablist"
				aria-label={label}
			>
				{items.map((item, index) => (
					<button
						type="button"
						key={item.id}
						id={`${id}-${item.id}`}
						role="tab"
						className="flex items-center gap-2 border-0 border-b-2 border-solid border-transparent bg-transparent px-0.5 pt-3 pb-4 text-sm whitespace-nowrap text-muted aria-selected:border-primary aria-selected:font-semibold aria-selected:text-ink"
						aria-selected={value === item.id}
						aria-controls={`${id}-panel`}
						tabIndex={value === item.id ? 0 : -1}
						onClick={() => onChange(item.id)}
						onKeyDown={(event) => {
							const nextIndex =
								event.key === "ArrowRight"
									? (index + 1) % items.length
									: event.key === "ArrowLeft"
										? (index + items.length - 1) % items.length
										: event.key === "Home"
											? 0
											: event.key === "End"
												? items.length - 1
												: null;
							if (nextIndex === null) return;
							const next = items[nextIndex];
							if (!next) return;
							event.preventDefault();
							onChange(next.id);
							document.getElementById(`${id}-${next.id}`)?.focus();
						}}
					>
						{item.label}
						{item.count != null && (
							<span className="min-w-5 rounded-control bg-active px-1 py-px text-xs text-success-text">
								{item.count}
							</span>
						)}
					</button>
				))}
			</div>
			<Panel
				className={panelClassName}
				id={`${id}-panel`}
				role="tabpanel"
				aria-labelledby={`${id}-${value}`}
			>
				{children}
			</Panel>
		</>
	);
}
