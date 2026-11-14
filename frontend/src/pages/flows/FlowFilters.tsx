import { useId } from "react";
import type { FlowGraph } from "../../api/flows.ts";
import { FLOW_NODE_ID_EXTERNAL } from "../../api/flows.ts";
import { Label } from "@/components/ui/label.tsx";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select.tsx";
import { Field } from "@/components/ui/field.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
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
					<Label htmlFor={`${id}-account`}>Account</Label>
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
				<Field>
					<Label id={`${id}-movement`}>Money</Label>
					<ToggleGroup
						aria-labelledby={`${id}-movement`}
						value={[filters.movement]}
						onValueChange={(next) => {
							const nextValue = next.find(
								(candidate) => candidate !== filters.movement,
							);
							if (nextValue !== undefined)
								onChange({ movement: nextValue as MovementFilter });
						}}
					>
						<ToggleGroupItem type="button" value="all">
							All
						</ToggleGroupItem>
						<ToggleGroupItem type="button" value="actual">
							Recorded
						</ToggleGroupItem>
						<ToggleGroupItem type="button" value="projected">
							Planned
						</ToggleGroupItem>
					</ToggleGroup>
				</Field>
			</div>
		</div>
	);
}
