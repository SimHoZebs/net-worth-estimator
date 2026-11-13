import { useId } from "react";
import type { FlowGraph } from "../../api/flows.ts";
import { FLOW_NODE_ID_EXTERNAL } from "../../api/flows.ts";
import { Select } from "../../components/Field.tsx";
import { SegmentedControl } from "../../components/SegmentedControl.tsx";
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
	return (
		<div className="flex flex-col gap-3">
			<FlowDateRangePicker
				startDate={filters.startDate}
				endDate={filters.endDate}
				onApply={(range) => onChange({ ...range })}
			/>
			<div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1">
				<label htmlFor={`${id}-account`} className="flex flex-col gap-1">
					<span className="text-xs text-muted">Account</span>
					<Select
						id={`${id}-account`}
						aria-label="Account"
						value={filters.accountId ?? "all"}
						onChange={(event) =>
							onChange({
								accountId:
									event.target.value === "all" ? null : event.target.value,
							})
						}
					>
						<option value="all">All accounts</option>
						{accounts.map((account) => (
							<option key={account.id} value={account.id}>
								{account.name}
							</option>
						))}
					</Select>
				</label>
				<div className="flex flex-col gap-1">
					<span id={`${id}-movement`} className="text-xs text-muted">
						Money
					</span>
					<SegmentedControl<MovementFilter>
						ariaLabel="Recorded or planned money"
						value={filters.movement}
						onChange={(movement) => onChange({ movement })}
						items={[
							{ value: "all", label: "All" },
							{ value: "actual", label: "Recorded" },
							{ value: "projected", label: "Planned" },
						]}
					/>
				</div>
			</div>
		</div>
	);
}
