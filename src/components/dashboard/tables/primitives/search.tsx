import { useMemo } from "react";
import { TableSearch } from "@/components/ui/table-search";
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
}

/** Search input shared by every read-only view. */
export function SearchField({
	value,
	onChange,
	placeholder,
}: SearchFieldProps) {
	return (
		<TableSearch value={value} onChange={onChange} placeholder={placeholder} />
	);
}
