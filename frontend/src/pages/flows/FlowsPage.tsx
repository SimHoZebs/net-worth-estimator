import { useCallback, useMemo, useState } from "react";
import { AlertCircle, ArrowUpRight, Waves } from "lucide-react";
import type { FlowGraph } from "../../api/flows.ts";
import { flowNodeName } from "../../api/flows.ts";
import { Alert, AlertDescription } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import {
	Empty,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
} from "@/components/ui/empty.tsx";
import { Skeleton } from "@/components/ui/skeleton.tsx";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group.tsx";
import {
	aggregateFlowEdges,
	buildSankeyInput,
	filterFlowEdges,
	hasFlowCycle,
	type AggregatedEdge,
} from "../../domain/flowDiagram.ts";
import { money, todayIso } from "../../domain/format.ts";
import { defaultFlowWindow } from "../../domain/flowWindow.ts";
import { useFlowGraph } from "../../state/useFlowGraph.ts";
import { cn } from "@/lib/utils.ts";
import { FlowEdgePanel } from "./FlowEdgePanel.tsx";
import { FlowFilters, type FlowFilterState } from "./FlowFilters.tsx";
import { FlowSankey } from "./FlowSankey.tsx";
import { FlowTable } from "./FlowTable.tsx";

type FlowView = "diagram" | "table";

const viewPillClassName =
	"rounded-control border-0 bg-transparent px-2 py-1 text-xs whitespace-nowrap text-muted pointer-coarse:min-h-12 aria-pressed:bg-surface aria-pressed:font-bold aria-pressed:text-ink aria-pressed:shadow-xs h-auto focus-visible:outline-solid focus-visible:ring-0 data-[state=on]:bg-surface";

// The default window is the current calendar month.
function defaultWindow(): { startDate: string; endDate: string } {
	return defaultFlowWindow(todayIso());
}

function TotalsSummary({ graph }: { graph: FlowGraph }) {
	const totals = graph.totals;
	const unobserved = graph.coverage.unobservedAccounts;
	return (
		<div className="flex flex-col gap-1 text-sm">
			<p>
				<span className="font-bold">{money(totals.actual.inflow)}</span>{" "}
				recorded in,{" "}
				<span className="font-bold">{money(totals.actual.outflow)}</span>{" "}
				recorded out
				{(totals.projected.inflow !== 0 || totals.projected.outflow !== 0) && (
					<>
						{" "}
						·{" "}
						<span className="font-bold">
							{money(totals.projected.inflow)}
						</span>{" "}
						planned in,{" "}
						<span className="font-bold">{money(totals.projected.outflow)}</span>{" "}
						planned out
					</>
				)}
				{(totals.actual.transfer !== 0 || totals.projected.transfer !== 0) && (
					<>
						{" "}
						·{" "}
						<span className="font-bold">
							{money(totals.actual.transfer + totals.projected.transfer)}
						</span>{" "}
						moved between accounts (counted once)
					</>
				)}
				.
			</p>
			{!graph.reconciliation.reconciled && (
				<Alert
					variant="default"
					role="note"
					className={cn(
						"border-warning-border bg-warning-bg text-warning-text",
					)}
				>
					<AlertDescription className="text-xs text-warning-text">
						Edge totals do not fully reconcile with their source records; the
						table below carries the exact figures.
					</AlertDescription>
				</Alert>
			)}
			{unobserved.length > 0 && (
				<p className="text-xs text-muted">
					Partial coverage: {unobserved.length}{" "}
					{unobserved.length === 1 ? "account has" : "accounts have"} no
					starting balance observation.
				</p>
			)}
		</div>
	);
}

/** Money-flow visualization over the VIS-01 graph contract: origins and
 * destinations as nodes, directional edges with thickness by amount,
 * date/account/movement filters, edge selection with source transactions,
 * aggregation with drilldowns, and a text/table alternative. */
export function FlowsPage() {
	const [window, setWindow] = useState(defaultWindow);
	const [filters, setFilters] = useState<
		Omit<FlowFilterState, "startDate" | "endDate">
	>({ movement: "all", accountId: null });
	const [view, setView] = useState<FlowView>("diagram");
	const [selection, setSelection] = useState<{
		owner: FlowGraph | null;
		key: string | null;
	}>({ owner: null, key: null });
	const [expanded, setExpanded] = useState(false);

	const query = useFlowGraph(window);
	const graph = query.data ?? null;
	// Lane indices disambiguate same-route edges, so a selection belongs to
	// exactly one graph instance: a re-sorted refetch never reattaches it
	// to a different lane. Derived during render, never synced by effect.
	const selectedKey = selection.owner === graph ? selection.key : null;

	const visible = useMemo<AggregatedEdge[]>(
		() =>
			graph
				? aggregateFlowEdges(
						filterFlowEdges(graph, {
							movement: filters.movement,
							accountId: filters.accountId,
						}),
					)
				: [],
		[graph, filters.movement, filters.accountId],
	);
	const input = useMemo(
		() => (graph ? buildSankeyInput(graph, visible) : null),
		[graph, visible],
	);
	// A one-way flow layout cannot draw a loop, and it weighs only
	// positive flow: cyclic or all-zero windows fall back to the table,
	// which still lists every lane exactly.
	const cyclic = input ? hasFlowCycle(input.lanes) : false;
	const measurable = input
		? input.lanes.some((lane) => Math.abs(lane.amount) > 0)
		: false;
	const sankeyHeight = input
		? Math.max(280, input.nodes.length * 44 + 128)
		: 280;
	const selected = useMemo<AggregatedEdge | null>(() => {
		if (!selectedKey || !input) return null;
		const found = input.lanes.find((lane) => lane.laneId === selectedKey);
		return found
			? {
					edge: found.edge,
					aggregated: found.aggregated,
					members: found.members,
				}
			: null;
	}, [input, selectedKey]);

	const selectLane = useCallback(
		(laneId: string | null) => {
			setSelection({ owner: graph, key: laneId });
			setExpanded(false);
		},
		[graph],
	);
	const nameOf = useCallback(
		(id: string) => (graph ? flowNodeName(graph, id) : id),
		[graph],
	);
	const chartDescription = `${input?.lanes.length ?? 0} money flows. Arrow keys move between flows; Enter inspects the focused flow's transactions. The focused flow is also announced directly.`;
	const changeFilters = (
		change: Partial<Omit<FlowFilterState, "startDate" | "endDate">>,
	) => {
		setFilters((current) => ({ ...current, ...change }));
		setSelection({ owner: graph, key: null });
		setExpanded(false);
	};
	const changeWindow = (change: Partial<typeof window>) => {
		const next = { ...window, ...change };
		// An inverted range issues no request: clamp the far bound instead.
		if (
			next.startDate !== "" &&
			next.endDate !== "" &&
			next.startDate > next.endDate
		) {
			if (change.startDate !== undefined) next.endDate = change.startDate;
			else if (change.endDate !== undefined) next.startDate = change.endDate;
		}
		setWindow(next);
		setSelection({ owner: graph, key: null });
		setExpanded(false);
	};

	const focusName =
		filters.accountId && graph ? flowNodeName(graph, filters.accountId) : null;

	return (
		<div className="flex flex-col gap-4">
			<FlowFilters
				graph={graph}
				filters={{ ...filters, ...window }}
				onChange={(change) => {
					const { startDate, endDate, ...rest } = change;
					if (startDate !== undefined || endDate !== undefined) {
						changeWindow({
							...(startDate !== undefined ? { startDate } : {}),
							...(endDate !== undefined ? { endDate } : {}),
						});
					}
					if (Object.keys(rest).length > 0) changeFilters(rest);
				}}
			/>
			{query.isPending && window.startDate !== "" && window.endDate !== "" && (
				<Skeleton
					className="h-64"
					role="status"
					aria-label="Loading money flows"
				/>
			)}
			{(window.startDate === "" || window.endDate === "") && (
				<Empty className="flex w-full min-w-0 flex-initial flex-col items-center gap-0 px-6 py-12 text-center">
					<EmptyHeader>
						<EmptyMedia>
							<span className="mb-5 grid size-16 place-items-center rounded-full bg-success-bg text-success-text">
								<Waves size={28} />
							</span>
						</EmptyMedia>
						<h3 className="text-lg">Choose both dates</h3>
						<EmptyDescription className="mt-2 mb-5 max-w-sm text-muted">
							Money flows need a start and an end date before the calculation
							runs.
						</EmptyDescription>
					</EmptyHeader>
				</Empty>
			)}
			{query.isError && (
				<Alert variant="destructive" className={cn("mb-5 p-5 text-sm")}>
					<AlertCircle
						size={20}
						className="mt-0.5 shrink-0"
						aria-hidden="true"
					/>
					<div className="min-w-0 break-words">
						<AlertDescription className="my-1 whitespace-pre-line">
							{query.error?.message ??
								"Money flows could not be loaded. Retry the request."}
						</AlertDescription>
						<Button
							variant="link"
							className="mt-2"
							onClick={() => void query.refetch()}
						>
							Retry <ArrowUpRight size={15} />
						</Button>
					</div>
				</Alert>
			)}
			{graph && (
				<>
					<TotalsSummary graph={graph} />
					<div className="flex flex-wrap items-center justify-between gap-3">
						<p className="text-xs text-muted" role="status">
							{focusName
								? `Showing flows touching ${focusName} (${visible.length} of ${graph.edges.length}). Totals still describe the whole window.`
								: `Showing all ${visible.length} flows from ${graph.startDate} through ${graph.endDate}.`}
						</p>
						<ToggleGroup
							aria-label="Diagram or table view"
							value={[view]}
							onValueChange={(next) => {
								const nextValue = next.find((candidate) => candidate !== view);
								if (nextValue !== undefined) setView(nextValue as FlowView);
							}}
							className={cn(
								"inline-flex gap-0.5 rounded-control border border-line bg-surface-2 p-1",
							)}
						>
							<ToggleGroupItem
								type="button"
								value="diagram"
								className={cn(viewPillClassName)}
							>
								Diagram
							</ToggleGroupItem>
							<ToggleGroupItem
								type="button"
								value="table"
								className={cn(viewPillClassName)}
							>
								Table
							</ToggleGroupItem>
						</ToggleGroup>
					</div>
					{visible.length === 0 || !input ? (
						<Empty className="flex w-full min-w-0 flex-initial flex-col items-center gap-0 px-6 py-12 text-center">
							<EmptyHeader>
								<EmptyMedia>
									<span className="mb-5 grid size-16 place-items-center rounded-full bg-success-bg text-success-text">
										<Waves size={28} />
									</span>
								</EmptyMedia>
								<h3 className="text-lg">No money movement in this view</h3>
								<EmptyDescription className="mt-2 mb-5 max-w-sm text-muted">
									Widen the dates or clear the account and money filters.
								</EmptyDescription>
							</EmptyHeader>
						</Empty>
					) : view === "table" ? (
						<FlowTable graph={graph} visible={visible} />
					) : cyclic || !measurable ? (
						<>
							<Alert
								variant="default"
								role="note"
								className={cn(
									"border-warning-border bg-warning-bg text-warning-text",
								)}
							>
								<AlertDescription className="text-xs text-warning-text">
									{cyclic
										? "These flows loop back on each other, so they cannot be drawn as a one-way diagram. The table below lists every flow with exact amounts."
										: "Every flow in this view is exactly zero, so widths cannot show them. The table below lists every flow with exact amounts."}
								</AlertDescription>
							</Alert>
							<FlowTable graph={graph} visible={visible} />
						</>
					) : (
						<>
							<FlowSankey
								nodes={input.nodes}
								lanes={input.lanes}
								height={sankeyHeight}
								selectedLaneId={selectedKey}
								ariaLabel={`Money-flow diagram from ${graph.startDate} through ${graph.endDate}`}
								ariaDescription={chartDescription}
								nameOf={nameOf}
								onSelectLane={selectLane}
							/>
							{selected && (
								<FlowEdgePanel
									graph={graph}
									item={selected}
									expanded={expanded}
									onToggleExpanded={() => setExpanded((value) => !value)}
								/>
							)}
						</>
					)}
				</>
			)}
		</div>
	);
}
