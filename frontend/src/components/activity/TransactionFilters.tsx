import { ArrowDownUp, Search } from "lucide-react";
import type { ActivityFilters } from "../../domain/accountActivity.ts";

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
				<button
					type="button"
					className="text-button transaction-order"
					onClick={() =>
						onChange({
							order: filters.order === "oldest" ? "newest" : "oldest",
						})
					}
				>
					<ArrowDownUp size={14} />
					{filters.order === "oldest" ? "Oldest first" : "Newest first"}
				</button>
			</div>
			<div className="account-activity-filters">
				<label>
					<span>Activity</span>
					<select
						aria-label="Transaction source"
						value={filters.source}
						onChange={(event) =>
							onChange({
								source: event.target.value as ActivityFilters["source"],
							})
						}
					>
						<option value="all">All transactions</option>
						<option value="recorded">Recorded ({recordedCount})</option>
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
						onChange={(event) =>
							onChange({
								direction: event.target.value as ActivityFilters["direction"],
							})
						}
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
						onChange={(event) =>
							onChange({
								period: event.target.value as ActivityFilters["period"],
							})
						}
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
