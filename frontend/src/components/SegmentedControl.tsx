import type { ReactNode } from "react";
import { mergeStyles } from "./mergeStyles.ts";
import {
	ToggleGroup as ShadcnToggleGroup,
	ToggleGroupItem as ShadcnToggleGroupItem,
} from "./ui/toggle-group.tsx";

type SegmentedControlItem<T extends string> = {
	value: T;
	label: ReactNode;
	ariaLabel?: string;
};

type SegmentedControlProps<T extends string> = {
	items: SegmentedControlItem<T>[];
	value: T;
	onChange: (value: T) => void;
	ariaLabel?: string;
	className?: string;
};

export const segmentedPillStyles =
	"rounded-control border-0 bg-transparent px-2 py-1 text-xs whitespace-nowrap text-muted pointer-coarse:min-h-12 aria-pressed:bg-surface aria-pressed:font-bold aria-pressed:text-ink aria-pressed:shadow-xs";

/**
 * Single-select segmented control on the shadcn toggle group. The group owns
 * the pressed state as a one-element value array (Base UI derives item
 * pressed state from the group value, never from item props); deselecting
 * the active segment is ignored so the single-value API never goes empty.
 * The legacy pill recipe stays the visual owner; h-auto and the data-state
 * override neutralize the primitive's fixed height and pressed fill. Nova
 * focus rings stay off so the global :focus-visible owner in typography.css
 * paints the single keyboard indicator.
 */
export function SegmentedControl<T extends string>({
	items,
	value,
	onChange,
	ariaLabel,
	className = "",
}: SegmentedControlProps<T>) {
	return (
		<ShadcnToggleGroup
			aria-label={ariaLabel}
			value={[value]}
			onValueChange={(next) => {
				const nextValue = next.find((candidate) => candidate !== value);
				if (nextValue !== undefined) onChange(nextValue as T);
			}}
			className={mergeStyles(
				"inline-flex gap-0.5 rounded-control border border-line bg-surface-2 p-1",
				className,
			)}
		>
			{items.map((item) => {
				return (
					<ShadcnToggleGroupItem
						key={item.value}
						type="button"
						value={item.value}
						aria-label={item.ariaLabel}
						className={mergeStyles(
							segmentedPillStyles,
							"h-auto focus-visible:outline-solid focus-visible:ring-0 data-[state=on]:bg-surface",
						)}
					>
						{item.label}
					</ShadcnToggleGroupItem>
				);
			})}
		</ShadcnToggleGroup>
	);
}
