import { useMemo } from "react";
import { useTableSearch } from "../_shared";

/**
 * Table search wiring shared by every read-only view: search state plus a
 * memoized filtered row list.
 */
export function useSearchFilter<T>(
	rows: readonly T[],
	matches: (row: T, query: string) => boolean,
	initial = "",
) {
	const { search, setSearch, query } = useTableSearch(initial);
	const visible = useMemo(
		() => rows.filter((row) => matches(row, query)),
		[rows, query, matches],
	);
	return { search, setSearch, query, visible };
}

interface SearchFieldProps {
	value: string;
	onChange: (value: string) => void;
	placeholder: string;
	/**
	 * Specific accessible label (e.g. "Search balance checkpoints").
	 * Falls back to the placeholder.
	 */
	ariaLabel?: string;
	/** When provided, announced via aria-live next to the input. */
	resultCount?: number;
	resultLabel?: string;
}

/**
 * Search input shared by every read-only view. Uses type="search" with a
 * specific aria-label and an aria-live result count.
 */
export function SearchField({
	value,
	onChange,
	placeholder,
	ariaLabel,
	resultCount,
	resultLabel = "results",
}: SearchFieldProps) {
	return (
		<div className="mb-3 flex flex-wrap items-center gap-2">
			<input
				type="search"
				value={value}
				onChange={(event) => onChange(event.currentTarget.value)}
				placeholder={placeholder}
				aria-label={ariaLabel ?? placeholder}
				className="min-h-11 w-full max-w-xs rounded-lg border border-input/90 bg-card/85 px-3 py-2.5 type-body shadow-sm outline-none placeholder:text-muted-foreground focus:border-ring focus-visible:ring-2 focus-visible:ring-ring/40 dark:border-white/10"
			/>
			{resultCount !== undefined ? (
				<span aria-live="polite" className="type-caption">
					{resultCount} {resultLabel}
				</span>
			) : null}
		</div>
	);
}
