import type { FlowGraph } from "../../api/flows.ts";
import { flowNodeName } from "../../api/flows.ts";
import { DataTable, TableCell, TableRow } from "../../components/DataTable.tsx";
import {
	describeFlowEdge,
	sankeyLaneId,
	type AggregatedEdge,
} from "../../domain/flowDiagram.ts";
import { dateLabel, money } from "../../domain/format.ts";

/** Accessible text/table alternative: the same visible edges as rows with
 * exact amounts, plus window totals, unmatched and unobserved money, and
 * coverage. This view — not the diagram — is the source of exact values. */
export function FlowTable({
	graph,
	visible,
}: {
	graph: FlowGraph;
	visible: AggregatedEdge[];
}) {
	const nameOf = (id: string) => flowNodeName(graph, id);
	const totals = graph.totals;
	return (
		<div className="flex flex-col gap-4">
			<DataTable
				caption={`Money flows from ${graph.startDate} through ${graph.endDate}.`}
				showHeaders
				columns={[
					{ label: "Flow" },
					{ label: "Amount" },
					{ label: "Transactions" },
				]}
			>
				{visible.map((item, index) => (
					<TableRow key={sankeyLaneId(item, index)}>
						<TableCell>
							{describeFlowEdge(item.edge, nameOf, money)}
							{item.aggregated
								? ` (groups ${item.members.length} small flows)`
								: ""}
						</TableCell>
						<TableCell>{money(Math.abs(item.edge.amount))}</TableCell>
						<TableCell>{item.edge.sources.length}</TableCell>
					</TableRow>
				))}
			</DataTable>
			<DataTable
				caption="Window totals by recorded and planned money."
				showHeaders
				columns={[
					{ label: "Total" },
					{ label: "Money in" },
					{ label: "Money out" },
					{ label: "Transfers" },
				]}
			>
				<TableRow>
					<TableCell>Recorded</TableCell>
					<TableCell>{money(totals.actual.inflow)}</TableCell>
					<TableCell>{money(totals.actual.outflow)}</TableCell>
					<TableCell>{money(totals.actual.transfer)}</TableCell>
				</TableRow>
				<TableRow>
					<TableCell>Planned</TableCell>
					<TableCell>{money(totals.projected.inflow)}</TableCell>
					<TableCell>{money(totals.projected.outflow)}</TableCell>
					<TableCell>{money(totals.projected.transfer)}</TableCell>
				</TableRow>
			</DataTable>
			<ul className="flex flex-col gap-1 text-xs text-muted">
				{totals.unmatched !== 0 && (
					<li>
						{money(Math.abs(totals.unmatched))} moved without a recorded path (
						{graph.reconciliation.unmatchedEvents}{" "}
						{graph.reconciliation.unmatchedEvents === 1
							? "transaction"
							: "transactions"}
						).
					</li>
				)}
				{totals.unobserved !== 0 && (
					<li>
						{money(Math.abs(totals.unobserved))} asserted by balance checks with
						no contributing transaction ({graph.reconciliation.correctionsCount}{" "}
						{graph.reconciliation.correctionsCount === 1
							? "correction"
							: "corrections"}
						).
					</li>
				)}
				{graph.coverage.unobservedAccounts.length > 0 && (
					<li>
						{graph.coverage.unobservedAccounts.length}{" "}
						{graph.coverage.unobservedAccounts.length === 1
							? "account has"
							: "accounts have"}{" "}
						no starting balance observation:{" "}
						{graph.coverage.unobservedAccounts
							.map((id) => flowNodeName(graph, id))
							.join(", ")}
						.
					</li>
				)}
				<li>
					Window {dateLabel(graph.startDate)} through {dateLabel(graph.endDate)}
					:{" "}
					{graph.reconciliation.reconciled
						? "edge totals reconcile with their source records."
						: "edge totals do not fully reconcile with their source records."}
				</li>
			</ul>
		</div>
	);
}
