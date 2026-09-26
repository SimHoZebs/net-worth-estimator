import { type ReactNode, useId } from "react";

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
				className={`page-tabs ${className}`}
				role="tablist"
				aria-label={label}
			>
				{items.map((item, index) => (
					<button
						type="button"
						key={item.id}
						id={`${id}-${item.id}`}
						role="tab"
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
						{item.count != null && <span>{item.count}</span>}
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
