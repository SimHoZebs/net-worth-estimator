import { cva } from "class-variance-authority";
import { useId } from "react";
import type { ActivityFilters } from "../../domain/accountActivity.ts";
import { parseUnion } from "../../domain/guards.ts";
import { TransactionSortButton } from "./TransactionSortButton.tsx";
import { SearchField, Select } from "../Field.tsx";

const filterSelectStyles = cva(
	"min-h-9 w-full px-2 py-2 text-xs text-success-text max-sm:min-h-11 max-sm:px-2 max-sm:text-base",
);

const sources = ["all", "historical", "projected"] as const;
const directions = ["all", "in", "out", "transfer"] as const;
const periods = ["all", "30-days", "12-months"] as const;

export function TransactionFilters({
	filters,
	recordedCount,
	totalCount,
	onChange,
}: {
	filters: ActivityFilters;
	recordedCount: number;
	totalCount: number;
	onChange: (change: Partial<ActivityFilters>) => void;
}) {
	const id = useId();
	return (
		<>
			<div className="flex items-center justify-between gap-4 max-sm:flex-wrap max-sm:gap-2">
				<SearchField
					label="Search account transactions"
					containerClassName="min-w-0 flex-1 max-sm:basis-full"
					className="w-full min-w-0 px-1 py-2 text-xs text-ellipsis max-sm:w-32"
					type="search"
					placeholder="Search transactions or accounts…"
					value={filters.query}
					onChange={(event) => onChange({ query: event.target.value })}
				/>
				<TransactionSortButton
					order={filters.order}
					onChange={(order) => onChange({ order })}
				/>
			</div>
			<div className="m-0 grid grid-cols-[1.2fr_1fr_1fr] gap-3 max-sm:grid-cols-2 max-sm:gap-3">
				<label
					htmlFor={`${id}-source`}
					className="flex flex-col gap-1 max-sm:col-span-full"
				>
					<span className="text-xs text-muted">Activity</span>
					<Select
						id={`${id}-source`}
						className={filterSelectStyles()}
						aria-label="Transaction source"
						value={filters.source}
						onChange={(event) => {
							const source = parseUnion(event.target.value, sources);
							if (source) onChange({ source });
						}}
					>
						<option value="all">All transactions</option>
						<option value="historical">Historical ({recordedCount})</option>
						<option value="projected">
							Projected ({totalCount - recordedCount})
						</option>
					</Select>
				</label>
				<label htmlFor={`${id}-direction`} className="flex flex-col gap-1">
					<span className="text-xs text-muted">Direction</span>
					<Select
						id={`${id}-direction`}
						className={filterSelectStyles()}
						aria-label="Transaction direction"
						value={filters.direction}
						onChange={(event) => {
							const direction = parseUnion(event.target.value, directions);
							if (direction) onChange({ direction });
						}}
					>
						<option value="all">All types</option>
						<option value="in">Money in</option>
						<option value="out">Money out</option>
						<option value="transfer">Transfers</option>
					</Select>
				</label>
				<label htmlFor={`${id}-period`} className="flex flex-col gap-1">
					<span className="text-xs text-muted">Dates</span>
					<Select
						id={`${id}-period`}
						className={filterSelectStyles()}
						aria-label="Transaction dates"
						value={filters.period}
						onChange={(event) => {
							const period = parseUnion(event.target.value, periods);
							if (period) onChange({ period });
						}}
					>
						<option value="all">All dates</option>
						<option value="30-days">Next 30 days</option>
						<option value="12-months">Next 12 months</option>
					</Select>
				</label>
			</div>
		</>
	);
}
