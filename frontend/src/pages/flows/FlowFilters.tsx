import { useId } from "react";
import type { FlowGraph } from "../../api/flows.ts";
import { FLOW_NODE_ID_EXTERNAL } from "../../api/flows.ts";
import {
	Field,
	FieldLabel,
	FieldLegend,
	FieldSet,
} from "@/components/ui/field.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group.tsx";
import type { MovementFilter } from "../../domain/flowDiagram.ts";
import { FlowDateRangePicker } from "./FlowDateRangePicker.tsx";

export interface FlowFilterState {
	startDate: string;
	endDate: string;
	movement: MovementFilter;
	accountId: string | null;
}

/** Date and account filters. Date commits refetch the graph; account focus
 * and movement re-render client-side with window totals unchanged. */
export function FlowFilters({
	graph,
	filters,
	onChange,
}: {
	graph: FlowGraph | null;
	filters: FlowFilterState;
	onChange: (change: Partial<FlowFilterState>) => void;
}) {
	const id = useId();
	const accounts = (graph?.nodes ?? [])
		.filter((node) => node.id !== FLOW_NODE_ID_EXTERNAL)
		.slice()
		.sort((a, b) => a.name.localeCompare(b.name));
	const accountItems: Record<string, string> = {
		all: "All accounts",
	};
	for (const account of accounts) accountItems[account.id] = account.name;
	return (
		<div className="flex flex-col gap-3">
			<FlowDateRangePicker
				startDate={filters.startDate}
				endDate={filters.endDate}
				onApply={(range) => onChange({ ...range })}
			/>
			<div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
				<Field>
					<FieldLabel htmlFor={`${id}-account`}>Account</FieldLabel>
					<Select
						value={filters.accountId ?? "all"}
						items={accountItems}
						onValueChange={(value) =>
							onChange({
								accountId: value === "all" ? null : value,
							})
						}
					>
						<SelectTrigger id={`${id}-account`} aria-label="Account">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="all">All accounts</SelectItem>
							{accounts.map((account) => (
								<SelectItem key={account.id} value={account.id}>
									{account.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>
				</Field>
				<FieldSet>
					<FieldLegend variant="label">Money</FieldLegend>
					<RadioGroup
						value={filters.movement}
						onValueChange={(value) =>
							onChange({ movement: value as MovementFilter })
						}
					>
						{[
							{ value: "all", label: "All" },
							{ value: "actual", label: "Recorded" },
							{ value: "projected", label: "Planned" },
						].map(({ value, label }) => (
							<Field key={value} orientation="horizontal">
								<RadioGroupItem value={value} id={`${id}-movement-${value}`} />
								<FieldLabel htmlFor={`${id}-movement-${value}`}>
									{label}
								</FieldLabel>
							</Field>
						))}
					</RadioGroup>
				</FieldSet>
			</div>
		</div>
	);
}
