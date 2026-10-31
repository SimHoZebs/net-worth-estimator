import type { ReactNode } from "react";

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

export function SegmentedControl<T extends string>({
  items,
  value,
  onChange,
  ariaLabel,
  className = "",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex gap-0.5 rounded-control border border-line bg-surface-2 p-1 ${className}`.trim()}
    >
      {items.map((item) => {
        const pressed = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            aria-pressed={pressed}
            aria-label={item.ariaLabel}
            onClick={() => onChange(item.value)}
            className="rounded-control border-0 bg-transparent px-2 py-1 text-xs whitespace-nowrap text-muted aria-pressed:bg-surface aria-pressed:font-bold aria-pressed:text-ink aria-pressed:shadow-xs"
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
