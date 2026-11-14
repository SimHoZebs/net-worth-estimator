import { useId, type ReactNode } from "react";
import { Search } from "lucide-react";
import type { ActivityFilters } from "../../domain/accountActivity.ts";
import { parseUnion } from "../../domain/guards.ts";
import { TransactionSortButton } from "./TransactionSortButton.tsx";
import { Field, FieldLabel } from "@/components/ui/field.tsx";
import {
	InputGroup,
	InputGroupAddon,
	InputGroupInput,
} from "@/components/ui/input-group.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";

const sources = ["all", "historical", "projected"] as const;
const directions = ["all", "in", "out", "transfer"] as const;
const periods = ["all", "30-days", "12-months"] as const;

const sourceLabels: Record<string, string> = {
	all: "All transactions",
	historical: "Historical",
	projected: "Projected",
};

const directionLabels: Record<string, string> = {
	all: "All types",
	in: "Money in",
	out: "Money out",
	transfer: "Transfers",
};

const periodLabels: Record<string, string> = {
	all: "All dates",
	"30-days": "Next 30 days",
	"12-months": "Next 12 months",
};

function FilterSelect({
	id,
	label,
	value,
	options,
	labels,
	optionLabels,
	onPick,
}: {
	id: string;
	label: string;
	value: string;
	options: readonly string[];
	labels?: Record<string, string>;
	optionLabels?: (value: string) => string;
	onPick: (value: string) => void;
}) {
	const handleChange = (next: string | null) => {
		if (next !== null) onPick(next);
	};
	return (
		<Field className="min-w-0">
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Select value={value} onValueChange={handleChange}>
				<SelectTrigger id={id} aria-label={label} className="w-full">
					<SelectValue>
						{labels?.[value] ?? optionLabels?.(value) ?? value}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{options.map((option) => (
						<SelectItem key={option} value={option}>
							{labels?.[option] ?? optionLabels?.(option) ?? option}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</Field>
	);
}

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
				<Field
					orientation="horizontal"
					className="min-w-0 flex-1 max-sm:basis-full"
				>
					<FieldLabel htmlFor={searchId} className="sr-only">
						Search account transactions
					</FieldLabel>
					<InputGroup className="min-w-0 flex-1">
						<InputGroupAddon>
							<Search size={16} aria-hidden="true" />
						</InputGroupAddon>
						<InputGroupInput
							id={searchId}
							type="search"
							placeholder="Search transactions or accounts…"
							value={filters.query}
							onChange={(event) => onChange({ query: event.target.value })}
						/>
					</InputGroup>
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
				<FilterSelect
					id={`${id}-source`}
					label="Activity"
					value={filters.source}
					options={sources}
					optionLabels={(value) =>
						value === "historical"
							? `Historical (${recordedCount})`
							: value === "projected"
								? `Projected (${totalCount - recordedCount})`
								: (sourceLabels[value] ?? value)
					}
					onPick={(value) => {
						const source = parseUnion(value, sources);
						if (source) onChange({ source });
					}}
				/>
				<FilterSelect
					id={`${id}-direction`}
					label="Direction"
					value={filters.direction}
					options={directions}
					labels={directionLabels}
					onPick={(value) => {
						const direction = parseUnion(value, directions);
						if (direction) onChange({ direction });
					}}
				/>
				<FilterSelect
					id={`${id}-period`}
					label="Dates"
					value={filters.period}
					options={periods}
					labels={periodLabels}
					onPick={(value) => {
						const period = parseUnion(value, periods);
						if (period) onChange({ period });
					}}
				/>
			</div>
		</>
	);
}
