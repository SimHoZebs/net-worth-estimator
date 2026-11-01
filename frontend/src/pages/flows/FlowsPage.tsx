import { useMemo, useState } from "react";
import { Waves } from "lucide-react";
import type { FlowGraph } from "../../api/flows.ts";
import { flowNodeName } from "../../api/flows.ts";
import { EmptyState } from "../../components/EmptyState.tsx";
import { ErrorNotice } from "../../components/ErrorNotice.tsx";
import { Notice } from "../../components/Notice.tsx";
import { SegmentedControl } from "../../components/SegmentedControl.tsx";
import { Skeleton } from "../../components/Skeleton.tsx";
import {
	aggregateFlowEdges,
	diagramEdgeId,
	filterFlowEdges,
	layoutFlowDiagram,
	type AggregatedEdge,
	type DiagramEdge,
} from "../../domain/flowDiagram.ts";
import { money, shiftDate, todayIso } from "../../domain/format.ts";
import { useFlowGraph } from "../../state/useFlowGraph.ts";
import { FlowDiagram } from "./FlowDiagram.tsx";
import { FlowEdgePanel } from "./FlowEdgePanel.tsx";
import { FlowFilters, type FlowFilterState } from "./FlowFilters.tsx";
import { FlowTable } from "./FlowTable.tsx";

type FlowView = "diagram" | "table";

// PROVISIONAL default window (VIS-01 leaves window defaults open): the
// twelve months through today. Change only with that decision.
function defaultWindow(): { startDate: string; endDate: string } {
	const endDate = todayIso();
	return { startDate: shiftDate({ date: endDate, days: -365 }), endDate };
}

function edgeIdentity(edge: DiagramEdge, index: number): string {
	return diagramEdgeId(edge, index);
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
				{(totals.projected.inflow !== 0 ||
					totals.projected.outflow !== 0) && (
					<>
						{" "}·{" "}
						<span className="font-bold">
							{money(totals.projected.inflow)}
						</span>{" "}
						planned in,{" "}
						<span className="font-bold">
							{money(totals.projected.outflow)}
						</span>{" "}
						planned out
					</>
				)}
				{(totals.actual.transfer !== 0 ||
					totals.projected.transfer !== 0) && (
					<>
						{" "}·{" "}
						<span className="font-bold">
							{money(
								totals.actual.transfer + totals.projected.transfer,
							)}
						</span>{" "}
						moved between accounts (counted once)
					</>
				)}
				.
			</p>
			{!graph.reconciliation.reconciled && (
				<Notice tone="warning">
					Edge totals do not fully reconcile with their source records;
					the table below carries the exact figures.
				</Notice>
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
	const diagram = useMemo(
		() => (graph ? layoutFlowDiagram(graph, visible) : null),
		[graph, visible],
	);
	const selected = useMemo<AggregatedEdge | null>(() => {
		if (!selectedKey || !diagram) return null;
		const position = diagram.edges.findIndex(
			(item, index) => edgeIdentity(item, index) === selectedKey,
		);
		const found = position >= 0 ? diagram.edges[position] : undefined;
		return found
			? {
					edge: found.edge,
					aggregated: found.aggregated,
					members: found.members,
				}
			: null;
	}, [diagram, selectedKey]);

	const select = (item: DiagramEdge | null) => {
		if (!item || !diagram) {
			setSelection({ owner: graph, key: null });
		} else {
			const position = diagram.edges.indexOf(item);
			setSelection({
				owner: graph,
				key: position >= 0 ? edgeIdentity(item, position) : null,
			});
		}
		setExpanded(false);
	};
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
			if (change.startDate !== undefined) next.endDate = next.startDate;
			else next.startDate = next.endDate;
		}
		setWindow(next);
		setSelection({ owner: graph, key: null });
		setExpanded(false);
	};

	const focusName =
		filters.accountId && graph
			? flowNodeName(graph, filters.accountId)
			: null;

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
				<Skeleton className="h-64" label="Loading money flows" />
			)}
			{(window.startDate === "" || window.endDate === "") && (
				<EmptyState
					icon={Waves}
					title="Choose both dates"
					description="Money flows need a start and an end date before the calculation runs."
				/>
			)}
			{query.isError && (
				<ErrorNotice
					message={
						query.error?.message ??
						"Money flows could not be loaded. Retry the request."
					}
					action="Retry"
					onAction={() => void query.refetch()}
				/>
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
						<SegmentedControl<FlowView>
							ariaLabel="Diagram or table view"
							value={view}
							onChange={setView}
							items={[
								{ value: "diagram", label: "Diagram" },
								{ value: "table", label: "Table" },
							]}
						/>
					</div>
					{visible.length === 0 ? (
						<EmptyState
							icon={Waves}
							title="No money movement in this view"
							description="Widen the dates or clear the account and money filters."
						/>
					) : view === "diagram" && diagram ? (
						<>
							<FlowDiagram
								graph={graph}
								diagram={diagram}
								selectedKey={selectedKey}
								onSelect={select}
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
					) : (
						<FlowTable graph={graph} visible={visible} />
					)}
				</>
			)}
		</div>
	);
}
