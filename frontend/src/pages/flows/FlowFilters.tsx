import { useId } from "react";
import type { FlowGraph } from "../../api/flows.ts";
import { FLOW_NODE_ID_EXTERNAL } from "../../api/flows.ts";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select.tsx";
import { Label } from "@/components/ui/label.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import type { MovementFilter } from "../../domain/flowDiagram.ts";
import { cn } from "@/lib/utils.ts";
import { FlowDateRangePicker } from "./FlowDateRangePicker.tsx";

export interface FlowFilterState {
	startDate: string;
	endDate: string;
	movement: MovementFilter;
	accountId: string | null;
}

const movementPillClassName =
	"rounded-control border-0 bg-transparent px-2 py-1 text-xs whitespace-nowrap text-muted pointer-coarse:min-h-12 aria-pressed:bg-surface aria-pressed:font-bold aria-pressed:text-ink aria-pressed:shadow-xs h-auto focus-visible:outline-solid focus-visible:ring-0 data-[state=on]:bg-surface";

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
				<div className="flex flex-col gap-1">
					<Label
						htmlFor={`${id}-account`}
						className="text-xs leading-normal font-semibold text-muted"
					>
						Account
					</Label>
					<NativeSelect
						id={`${id}-account`}
						aria-label="Account"
						value={filters.accountId ?? "all"}
						onChange={(event) =>
							onChange({
								accountId:
									event.target.value === "all" ? null : event.target.value,
							})
						}
						className="w-full"
					>
						<NativeSelectOption value="all">All accounts</NativeSelectOption>
						{accounts.map((account) => (
							<NativeSelectOption key={account.id} value={account.id}>
								{account.name}
							</NativeSelectOption>
						))}
					</NativeSelect>
				</div>
				<div className="flex flex-col gap-1">
					<span id={`${id}-movement`} className="text-xs text-muted">
						Money
					</span>
					<ToggleGroup
						aria-label="Recorded or planned money"
						value={[filters.movement]}
						onValueChange={(next) => {
							const nextValue = next.find(
								(candidate) => candidate !== filters.movement,
							);
							if (nextValue !== undefined)
								onChange({ movement: nextValue as MovementFilter });
						}}
						className={cn(
							"inline-flex gap-0.5 rounded-control border border-line bg-surface-2 p-1",
						)}
					>
						<ToggleGroupItem
							type="button"
							value="all"
							className={cn(movementPillClassName)}
						>
							All
						</ToggleGroupItem>
						<ToggleGroupItem
							type="button"
							value="actual"
							className={cn(movementPillClassName)}
						>
							Recorded
						</ToggleGroupItem>
						<ToggleGroupItem
							type="button"
							value="projected"
							className={cn(movementPillClassName)}
						>
							Planned
						</ToggleGroupItem>
					</ToggleGroup>
				</div>
			</div>
		</div>
	);
}
