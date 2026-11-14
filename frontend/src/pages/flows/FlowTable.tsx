import type { FlowGraph } from "../../api/flows.ts";
import { flowNodeName } from "../../api/flows.ts";
import {
	Table,
	TableBody,
	TableCaption,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table.tsx";
import {
	describeFlowEdge,
	sankeyLaneId,
	type AggregatedEdge,
} from "../../domain/flowDiagram.ts";
import { dateLabel, money } from "../../domain/format.ts";
import { cn } from "@/lib/utils.ts";

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
			{/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- A scroll region must accept focus so keyboard users can pan the table. */}
			<div
				tabIndex={0}
				role="region"
				aria-label={`Money flows from ${graph.startDate} through ${graph.endDate}.`}
				className="relative max-w-full overflow-x-auto"
			>
				<Table className={cn("border-collapse text-left")}>
					<TableCaption className="sr-only">
						Money flows from {graph.startDate} through {graph.endDate}.
					</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead>Flow</TableHead>
							<TableHead>Amount</TableHead>
							<TableHead>Transactions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
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
					</TableBody>
				</Table>
			</div>
			{/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- A scroll region must accept focus so keyboard users can pan the table. */}
			<div
				tabIndex={0}
				role="region"
				aria-label="Window totals by recorded and planned money."
				className="relative max-w-full overflow-x-auto"
			>
				<Table className={cn("border-collapse text-left")}>
					<TableCaption className="sr-only">
						Window totals by recorded and planned money.
					</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead>Total</TableHead>
							<TableHead>Money in</TableHead>
							<TableHead>Money out</TableHead>
							<TableHead>Transfers</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
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
					</TableBody>
				</Table>
			</div>
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
