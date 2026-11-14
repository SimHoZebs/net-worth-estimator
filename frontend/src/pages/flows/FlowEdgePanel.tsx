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
	type AggregatedEdge,
} from "../../domain/flowDiagram.ts";
import { dateLabel, money } from "../../domain/format.ts";
import { cn } from "@/lib/utils.ts";
import { TransferMatchNote } from "./TransferMatchNote.tsx";

/** Selected-edge inspector: the edge's route and amount plus every source
 * transaction behind it. Sources are whole dated records, so a split event
 * feeding several edges reads identically on each of them. */
export function FlowEdgePanel({
	graph,
	item,
	expanded,
	onToggleExpanded,
}: {
	graph: FlowGraph;
	item: AggregatedEdge;
	expanded: boolean;
	onToggleExpanded: () => void;
}) {
	const { edge } = item;
	const nameOf = (id: string) => flowNodeName(graph, id);
	const transactionIds = Array.from(
		new Set(edge.sources.map((source) => source.transactionId)),
	);
	return (
		<section
			aria-label="Selected money flow"
			className="mt-4 border-t border-line pt-4"
		>
			<h3 className="text-sm font-bold">
				{describeFlowEdge(edge, nameOf, money)}
			</h3>
			<p className="mt-1 text-xs text-muted">
				{edge.sources.length}{" "}
				{edge.sources.length === 1 ? "transaction" : "transactions"} behind this
				flow
				{item.aggregated
					? `, grouped from ${item.members.length} small flows`
					: ""}
				.
			</p>
			{item.aggregated && (
				<button
					type="button"
					onClick={onToggleExpanded}
					aria-expanded={expanded}
					className="mt-2 text-xs font-bold text-success-text underline"
				>
					{expanded
						? "Hide the grouped flows"
						: `Show the ${item.members.length} grouped flows`}
				</button>
			)}
			{expanded &&
				item.members.map((member) => (
					<p
						key={`${member.from} ${member.to} ${member.sources.map((source) => source.transactionId).join(",")}`}
						className="mt-1 text-xs text-muted"
					>
						{describeFlowEdge(member, nameOf, money)} — {member.sources.length}{" "}
						{member.sources.length === 1 ? "transaction" : "transactions"}
					</p>
				))}
			{/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- A scroll region must accept focus so keyboard users can pan the table. */}
			<div
				tabIndex={0}
				role="region"
				aria-label="Transactions behind the selected flow."
				className="relative max-w-full overflow-x-auto"
			>
				<Table className={cn("border-collapse text-left")}>
					<TableCaption className="sr-only">
						Transactions behind the selected flow.
					</TableCaption>
					<TableHeader>
						<TableRow>
							<TableHead>Date</TableHead>
							<TableHead>Requested</TableHead>
							<TableHead>Realized</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{edge.sources.map((source) => (
							<TableRow
								key={`${source.transactionId} ${source.date} ${source.sequence}`}
							>
								<TableCell>{dateLabel(source.date)}</TableCell>
								<TableCell>{money(source.requestedAmount)}</TableCell>
								<TableCell>{money(source.realizedAmount)}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
			{edge.kind === "transfer" && (
				<TransferMatchNote
					transactionIds={transactionIds}
					transferCount={edge.sources.length}
				/>
			)}
		</section>
	);
}
