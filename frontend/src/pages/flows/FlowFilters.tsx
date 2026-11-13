import { useId } from "react";
import type { FlowGraph } from "../../api/flows.ts";
import { FLOW_NODE_ID_EXTERNAL } from "../../api/flows.ts";
import { Input, Select } from "../../components/Field.tsx";
import {
	SegmentedControl,
	segmentedPillStyles,
} from "../../components/SegmentedControl.tsx";
import type { MovementFilter } from "../../domain/flowDiagram.ts";
import {
	FLOW_RANGE_PRESETS,
	flowPresetRange,
	matchFlowPreset,
} from "../../domain/flowWindow.ts";
import { todayIso } from "../../domain/format.ts";

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
	const activePreset = matchFlowPreset(
		{ startDate: filters.startDate, endDate: filters.endDate },
		todayIso(),
	);
	return (
		<div className="flex flex-col gap-3">
			<div
				role="group"
				aria-label="Date range"
				className="inline-flex flex-wrap gap-0.5 rounded-control border border-line bg-surface-2 p-1"
			>
				{FLOW_RANGE_PRESETS.map((preset) => (
					<button
						key={preset.id}
						type="button"
						aria-pressed={activePreset === preset.id}
						onClick={() => onChange({ ...flowPresetRange(preset.id, todayIso()) })}
						className={segmentedPillStyles}
					>
						{preset.label}
					</button>
				))}
			</div>
			<div className="grid grid-cols-2 gap-3 max-sm:grid-cols-1 lg:grid-cols-4">
				<label htmlFor={`${id}-start`} className="flex flex-col gap-1">
					<span className="text-xs text-muted">From</span>
					<Input
						id={`${id}-start`}
						aria-label="From date"
						type="date"
						value={filters.startDate}
						max={filters.endDate}
						onChange={(event) => onChange({ startDate: event.target.value })}
					/>
				</label>
				<label htmlFor={`${id}-end`} className="flex flex-col gap-1">
					<span className="text-xs text-muted">Through</span>
					<Input
						id={`${id}-end`}
						aria-label="Through date"
						type="date"
						value={filters.endDate}
						min={filters.startDate}
						onChange={(event) => onChange({ endDate: event.target.value })}
					/>
				</label>
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
