import { finite, isRecord, parseUnion, stringValue } from "../domain/guards.ts";
import type {
	FlowClassTotals as GeneratedFlowClassTotals,
	FlowCoverage as GeneratedFlowCoverage,
	FlowEdge as GeneratedFlowEdge,
	FlowGraph as GeneratedFlowGraph,
	FlowNode as GeneratedFlowNode,
	FlowReconciliation as GeneratedFlowReconciliation,
	FlowSourceRecord as GeneratedFlowSourceRecord,
	FlowTotals as GeneratedFlowTotals,
	FlowUnmatchedEvent as GeneratedFlowUnmatchedEvent,
	FlowUnobservedCorrection as GeneratedFlowUnobservedCorrection,
} from "./generated/model/index.ts";

/**
 * Client view of the generated /v1/flows payloads. The generated tree owns
 * the shape; this module owns the display labels, the narrow movement/kind
 * unions, and the guard that turns generated nullable arrays and free-form
 * strings into the non-null, typed values the flow screen consumes.
 */

export const FLOW_NODE_ID_EXTERNAL = "external";

// Plain-language name for the external counterparty. The contract carries
// the backend's node name, but the UI never shows a raw id or a bare
// "External": every renderer shares this label.
export const FLOW_EXTERNAL_LABEL = "Outside accounts";

export const FLOW_KINDS = ["inflow", "outflow", "transfer"] as const;
export const FLOW_MOVEMENTS = ["actual", "projected"] as const;

export type FlowMovement = (typeof FLOW_MOVEMENTS)[number];
export type FlowKind = (typeof FLOW_KINDS)[number];

export type FlowNode = GeneratedFlowNode;

export type FlowSourceRecord = GeneratedFlowSourceRecord;

export type FlowEdge = Omit<
	GeneratedFlowEdge,
	"kind" | "movement" | "sources"
> & {
	kind: FlowKind;
	movement: FlowMovement;
	sources: FlowSourceRecord[];
};

export type FlowUnmatchedEvent = GeneratedFlowUnmatchedEvent;
export type FlowUnobservedCorrection = GeneratedFlowUnobservedCorrection;

export type FlowCoverage = Omit<
	GeneratedFlowCoverage,
	"observedAccounts" | "unobservedAccounts"
> & {
	observedAccounts: string[];
	unobservedAccounts: string[];
};

export type FlowClassTotals = GeneratedFlowClassTotals;
export type FlowTotals = GeneratedFlowTotals;
export type FlowReconciliation = GeneratedFlowReconciliation;

export type FlowGraph = Omit<
	GeneratedFlowGraph,
	"nodes" | "edges" | "unmatched" | "unobserved" | "coverage"
> & {
	nodes: FlowNode[];
	edges: FlowEdge[];
	unmatched: FlowUnmatchedEvent[];
	unobserved: FlowUnobservedCorrection[];
	coverage: FlowCoverage;
};

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

function invalid(reason: string): Error {
	return new Error(`Invalid money-flow graph: ${reason}`);
}

function requiredString(record: Record<string, unknown>, key: string): string {
	const value = stringValue(record[key]);
	if (value === null) throw invalid(`${key} must be a string`);
	return value;
}

function requiredNumber(record: Record<string, unknown>, key: string): number {
	const value = finite(record[key]);
	if (value === null) throw invalid(`${key} must be a finite number`);
	return value;
}

function requiredBoolean(
	record: Record<string, unknown>,
	key: string,
): boolean {
	const value = record[key];
	if (typeof value !== "boolean") throw invalid(`${key} must be a boolean`);
	return value;
}

/** Generated nullable arrays mean "no rows"; the UI consumes empty arrays. */
function rowArray(
	record: Record<string, unknown>,
	key: string,
): Record<string, unknown>[] {
	const value = record[key];
	if (value === null || value === undefined) return [];
	if (!Array.isArray(value)) throw invalid(`${key} must be an array`);
	return value.filter(isRecord);
}

function readNode(value: Record<string, unknown>): FlowNode {
	return {
		id: requiredString(value, "id"),
		name: requiredString(value, "name"),
		external: requiredBoolean(value, "external"),
		enabled: requiredBoolean(value, "enabled"),
		inflow: requiredNumber(value, "inflow"),
		outflow: requiredNumber(value, "outflow"),
	};
}

function readSource(value: Record<string, unknown>): FlowSourceRecord {
	return {
		transactionId: requiredString(value, "transactionId"),
		date: requiredString(value, "date"),
		sequence: requiredNumber(value, "sequence"),
		requestedAmount: requiredNumber(value, "requestedAmount"),
		realizedAmount: requiredNumber(value, "realizedAmount"),
	};
}

function readEdge(value: Record<string, unknown>): FlowEdge {
	const kind = parseUnion(value.kind, FLOW_KINDS);
	if (kind === null) throw invalid("edge.kind is not a flow kind");
	const movement = parseUnion(value.movement, FLOW_MOVEMENTS);
	if (movement === null) throw invalid("edge.movement is not a flow movement");
	const sources = value.sources;
	if (sources !== null && sources !== undefined && !Array.isArray(sources))
		throw invalid("edge.sources must be an array");
	return {
		from: requiredString(value, "from"),
		to: requiredString(value, "to"),
		kind,
		movement,
		amount: requiredNumber(value, "amount"),
		sources: Array.isArray(sources)
			? sources.filter(isRecord).map(readSource)
			: [],
	};
}

function readUnmatched(value: Record<string, unknown>): FlowUnmatchedEvent {
	return {
		transactionId: requiredString(value, "transactionId"),
		date: requiredString(value, "date"),
		sequence: requiredNumber(value, "sequence"),
		realizedAmount: requiredNumber(value, "realizedAmount"),
	};
}

function readUnobserved(
	value: Record<string, unknown>,
): FlowUnobservedCorrection {
	return {
		accountId: requiredString(value, "accountId"),
		date: requiredString(value, "date"),
		observedBalance: requiredNumber(value, "observedBalance"),
		modeledBalance: requiredNumber(value, "modeledBalance"),
		adjustment: requiredNumber(value, "adjustment"),
	};
}

function readClassTotals(value: unknown): FlowClassTotals {
	if (!isRecord(value)) throw invalid("totals class must be an object");
	return {
		inflow: requiredNumber(value, "inflow"),
		outflow: requiredNumber(value, "outflow"),
		transfer: requiredNumber(value, "transfer"),
	};
}

function readTotals(value: unknown): FlowTotals {
	if (!isRecord(value)) throw invalid("totals must be an object");
	return {
		actual: readClassTotals(value.actual),
		projected: readClassTotals(value.projected),
		unmatched: requiredNumber(value, "unmatched"),
		unobserved: requiredNumber(value, "unobserved"),
	};
}

function readReconciliation(value: unknown): FlowReconciliation {
	if (!isRecord(value)) throw invalid("reconciliation must be an object");
	return {
		windowEvents: requiredNumber(value, "windowEvents"),
		classifiedEvents: requiredNumber(value, "classifiedEvents"),
		unmatchedEvents: requiredNumber(value, "unmatchedEvents"),
		eventsInflow: requiredNumber(value, "eventsInflow"),
		eventsOutflow: requiredNumber(value, "eventsOutflow"),
		eventsTransfer: requiredNumber(value, "eventsTransfer"),
		edgesInflow: requiredNumber(value, "edgesInflow"),
		edgesOutflow: requiredNumber(value, "edgesOutflow"),
		edgesTransfer: requiredNumber(value, "edgesTransfer"),
		correctionsCount: requiredNumber(value, "correctionsCount"),
		unobservedSum: requiredNumber(value, "unobservedSum"),
		reconciled: requiredBoolean(value, "reconciled"),
	};
}

function stringList(value: unknown, key: string): string[] {
	if (value === null || value === undefined) return [];
	if (!Array.isArray(value)) throw invalid(`${key} must be an array`);
	return value.filter((item): item is string => typeof item === "string");
}

function readCoverage(value: unknown): FlowCoverage {
	if (!isRecord(value)) throw invalid("coverage must be an object");
	return {
		observedAccounts: stringList(value.observedAccounts, "observedAccounts"),
		unobservedAccounts: stringList(
			value.unobservedAccounts,
			"unobservedAccounts",
		),
	};
}

/**
 * Guard over the generated `FlowGraph` payload. Every required key is read
 * and checked: a null array becomes an empty list, while a null scalar or an
 * unknown kind/movement fails the payload instead of reaching the diagram.
 */
export function isFlowGraph(value: unknown): value is FlowGraph {
	if (!isRecord(value)) return false;
	if (!REQUIRED_GRAPH_KEYS.every((key) => key in value)) return false;
	try {
		readFlowGraph(value);
		return true;
	} catch {
		return false;
	}
}

/** Build the client graph from a validated payload. Throws with a message
 * suitable for display when the server payload is malformed. */
export function readFlowGraph(value: unknown): FlowGraph {
	if (!isRecord(value)) throw invalid("expected an object");
	if (!REQUIRED_GRAPH_KEYS.every((key) => key in value))
		throw invalid("missing required graph keys");
	return {
		startDate: requiredString(value, "startDate"),
		endDate: requiredString(value, "endDate"),
		nodes: rowArray(value, "nodes").map(readNode),
		edges: rowArray(value, "edges").map(readEdge),
		unmatched: rowArray(value, "unmatched").map(readUnmatched),
		unobserved: rowArray(value, "unobserved").map(readUnobserved),
		coverage: readCoverage(value.coverage),
		totals: readTotals(value.totals),
		reconciliation: readReconciliation(value.reconciliation),
	};
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
