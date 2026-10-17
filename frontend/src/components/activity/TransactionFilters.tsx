import { Search } from "lucide-react";
import type { ActivityFilters } from "../../domain/accountActivity.ts";
import { parseUnion } from "../../domain/guards.ts";
import { TransactionSortButton } from "./TransactionSortButton.tsx";

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
	return (
		<>
			<div className="account-activity-toolbar">
				<label className="search-field account-activity-search">
					<Search size={17} aria-hidden="true" />
					<input
						type="search"
						aria-label="Search account transactions"
						placeholder="Search transactions or accounts…"
						value={filters.query}
						onChange={(event) => onChange({ query: event.target.value })}
					/>
				</label>
				<TransactionSortButton
					order={filters.order}
					onChange={(order) => onChange({ order })}
				/>
			</div>
			<div className="account-activity-filters">
				<label>
					<span>Activity</span>
					<select
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
					</select>
				</label>
				<label>
					<span>Direction</span>
					<select
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
					</select>
				</label>
				<label>
					<span>Dates</span>
					<select
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
					</select>
				</label>
			</div>
		</>
	);
}
