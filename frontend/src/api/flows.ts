import type {
	FinancialModel,
	ModelValidationIssue,
	ProjectionRuntimeSettings,
} from "./contracts.ts";
import { waypointFetch } from "./waypoint-fetch.ts";

// Money-flow graph contract (VIS-02 view of VIS-01).
//
// These shapes mirror the backend POST /v1/flows contract owned by VIS-01
// (backend/internal/types/flowgraph.go). They are duplicated here — not
// generated — because VIS-01 has not landed: its OpenAPI schema is absent
// from frontend/openapi.snapshot.json, so orval cannot emit them yet. When
// VIS-01 lands, delete this mirror and switch requestFlowGraph to the
// generated build-flow-graph endpoint. Field names must stay identical to
// the backend JSON; flowContractCheck below guards the load-bearing keys.

export const FLOW_NODE_ID_EXTERNAL = "external";

// Plain-language name for the external counterparty. The contract carries
// the backend's node name, but the UI never shows a raw id or a bare
// "External": every renderer shares this label.
export const FLOW_EXTERNAL_LABEL = "Outside accounts";

export type FlowMovement = "actual" | "projected";
export type FlowKind = "inflow" | "outflow" | "transfer";

export interface FlowNode {
	id: string;
	name: string;
	external: boolean;
	enabled: boolean;
	inflow: number;
	outflow: number;
}

export interface FlowSourceRecord {
	postingId: string;
	date: string;
	sequence: number;
	requestedAmount: number;
	realizedAmount: number;
}

export interface FlowEdge {
	from: string;
	to: string;
	kind: FlowKind;
	movement: FlowMovement;
	amount: number;
	sources: FlowSourceRecord[];
}

export interface FlowUnmatchedEvent {
	postingId: string;
	date: string;
	sequence: number;
	realizedAmount: number;
}

export interface FlowUnobservedCorrection {
	accountId: string;
	date: string;
	observedBalance: number;
	modeledBalance: number;
	adjustment: number;
}

export interface FlowCoverage {
	observedAccounts: string[];
	unobservedAccounts: string[];
}

export interface FlowClassTotals {
	inflow: number;
	outflow: number;
	transfer: number;
}

export interface FlowTotals {
	actual: FlowClassTotals;
	projected: FlowClassTotals;
	unmatched: number;
	unobserved: number;
}

export interface FlowReconciliation {
	windowEvents: number;
	classifiedEvents: number;
	unmatchedEvents: number;
	eventsInflow: number;
	eventsOutflow: number;
	eventsTransfer: number;
	edgesInflow: number;
	edgesOutflow: number;
	edgesTransfer: number;
	correctionsCount: number;
	unobservedSum: number;
	reconciled: boolean;
}

export interface FlowGraph {
	startDate: string;
	endDate: string;
	nodes: FlowNode[];
	edges: FlowEdge[];
	unmatched: FlowUnmatchedEvent[];
	unobserved: FlowUnobservedCorrection[];
	coverage: FlowCoverage;
	totals: FlowTotals;
	reconciliation: FlowReconciliation;
}

export interface FlowGraphRequest {
	settings: ProjectionRuntimeSettings;
	range: {
		startDate?: string;
		endDate?: string;
	};
}

export interface FlowGraphResponse {
	graph?: FlowGraph | null;
	issues?: ModelValidationIssue[];
	error?: string;
}

const REQUIRED_GRAPH_KEYS = [
	"startDate",
	"endDate",
	"nodes",
	"edges",
	"unmatched",
	"unobserved",
	"coverage",
	"totals",
	"reconciliation",
] as const;

function isFlowGraph(value: unknown): value is FlowGraph {
	if (typeof value !== "object" || value === null) return false;
	const graph = value as Record<string, unknown>;
	if (!REQUIRED_GRAPH_KEYS.every((key) => key in graph)) return false;
	return (
		Array.isArray(graph.nodes) &&
		Array.isArray(graph.edges) &&
		typeof graph.totals === "object" &&
		graph.totals !== null &&
		typeof graph.reconciliation === "object" &&
		graph.reconciliation !== null
	);
}

/** Request a time-bounded money-flow graph. Production omits the model: the
 * stored model supplies the base, matching the deterministic projection. */
export async function requestFlowGraph(
	request: FlowGraphRequest,
	options?: { signal?: AbortSignal },
): Promise<FlowGraph> {
	const response = await waypointFetch<FlowGraphResponse>("/v1/flows", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(request),
		signal: options?.signal,
	});
	const body = (response as { data?: FlowGraphResponse }).data;
	if (!body || !isFlowGraph(body.graph)) {
		if (body?.error) throw new Error(body.error);
		const errors = (body?.issues ?? []).filter(
			(issue) => issue.severity === "error",
		);
		if (errors.length)
			throw new Error(errors.map((issue) => issue.message).join(" "));
		throw new Error(
			"The server returned no money-flow graph. Retry the request.",
		);
	}
	return body.graph;
}

/** Node lookup shared by the diagram, the table, and edge selection. */
export function flowNodeById(
	graph: FlowGraph,
	id: string,
): FlowNode | undefined {
	return graph.nodes.find((node) => node.id === id);
}

/** Display name for a node id, falling back to the raw id. The external
 * counterparty always reads as plain language: the backend's node name is
 * uncontrolled copy. */
export function flowNodeName(graph: FlowGraph, id: string): string {
	if (id === FLOW_NODE_ID_EXTERNAL) return FLOW_EXTERNAL_LABEL;
	return flowNodeById(graph, id)?.name || id;
}

export type { FinancialModel };
