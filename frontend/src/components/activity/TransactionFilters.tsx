import { useId, type ReactNode } from "react";
import { Search } from "lucide-react";
import type { ActivityFilters } from "../../domain/accountActivity.ts";
import { parseUnion } from "../../domain/guards.ts";
import { TransactionSortButton } from "./TransactionSortButton.tsx";
import { Field } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import { cn } from "@/lib/utils.ts";

const sources = ["all", "historical", "projected"] as const;
const directions = ["all", "in", "out", "transfer"] as const;
const periods = ["all", "30-days", "12-months"] as const;

export function TransactionFilters({
	filters,
	recordedCount,
	totalCount,
	onChange,
	action,
}: {
	filters: ActivityFilters;
	recordedCount: number;
	totalCount: number;
	onChange: (change: Partial<ActivityFilters>) => void;
	action?: ReactNode;
}) {
	const id = useId();
	const searchId = `${id}-search`;
	return (
		<>
			<div className="flex items-center justify-between gap-4 max-sm:flex-wrap max-sm:gap-2">
				<Field className="min-w-0 flex-1 max-sm:basis-full">
					<Label
						htmlFor={searchId}
						className="inline-flex items-center gap-2 text-subtle"
					>
						<Search size={16} aria-hidden="true" />
						<span className="sr-only">Search account transactions</span>
					</Label>
					<Input
						id={searchId}
						type="search"
						placeholder="Search transactions or accounts…"
						value={filters.query}
						onChange={(event) => onChange({ query: event.target.value })}
						className="w-full min-w-0 px-1 py-2 text-xs text-ellipsis"
					/>
				</Field>
				<div className="flex shrink-0 flex-wrap items-center gap-3">
					<TransactionSortButton
						order={filters.order}
						onChange={(order) => onChange({ order })}
					/>
					{action}
				</div>
			</div>
			<div className="m-0 grid grid-cols-[1.2fr_1fr_1fr] gap-3 max-sm:grid-cols-2 max-sm:gap-3">
				<div className="flex flex-col gap-1 max-sm:col-span-full">
					<Label htmlFor={`${id}-source`} className="text-xs text-muted">
						Activity
					</Label>
					<Select
						value={filters.source}
						onValueChange={(value) => {
							const source = parseUnion(value, sources);
							if (source) onChange({ source });
						}}
					>
						<SelectTrigger
							id={`${id}-source`}
							aria-label="Transaction source"
							className={cn(
								"min-h-9 w-full px-2 py-2 text-xs text-success-text max-sm:min-h-11 max-sm:px-2 max-sm:text-base",
							)}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All transactions</SelectItem>
							<SelectItem value="historical">
								Historical ({recordedCount})
							</SelectItem>
							<SelectItem value="projected">
								Projected ({totalCount - recordedCount})
							</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor={`${id}-direction`} className="text-xs text-muted">
						Direction
					</Label>
					<Select
						value={filters.direction}
						onValueChange={(value) => {
							const direction = parseUnion(value, directions);
							if (direction) onChange({ direction });
						}}
					>
						<SelectTrigger
							id={`${id}-direction`}
							aria-label="Transaction direction"
							className={cn(
								"min-h-9 w-full px-2 py-2 text-xs text-success-text max-sm:min-h-11 max-sm:px-2 max-sm:text-base",
							)}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All types</SelectItem>
							<SelectItem value="in">Money in</SelectItem>
							<SelectItem value="out">Money out</SelectItem>
							<SelectItem value="transfer">Transfers</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<div className="flex flex-col gap-1">
					<Label htmlFor={`${id}-period`} className="text-xs text-muted">
						Dates
					</Label>
					<Select
						value={filters.period}
						onValueChange={(value) => {
							const period = parseUnion(value, periods);
							if (period) onChange({ period });
						}}
					>
						<SelectTrigger
							id={`${id}-period`}
							aria-label="Transaction dates"
							className={cn(
								"min-h-9 w-full px-2 py-2 text-xs text-success-text max-sm:min-h-11 max-sm:px-2 max-sm:text-base",
							)}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All dates</SelectItem>
							<SelectItem value="30-days">Next 30 days</SelectItem>
							<SelectItem value="12-months">Next 12 months</SelectItem>
						</SelectContent>
					</Select>
				</div>
			</div>
		</>
	);
}
