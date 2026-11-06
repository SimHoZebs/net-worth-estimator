import { FLOW_NODE_ID_EXTERNAL, type FlowGraph } from "../api/flows.ts";

/** Shared contract-shaped fixture: one inflow, one outflow, one transfer,
 * one planned edge, and one dust edge that must aggregate. */
export function graphFixture(): FlowGraph {
	return {
		startDate: "2026-01-01",
		endDate: "2026-12-31",
		nodes: [
			{
				id: "checking",
				name: "Everyday checking",
				external: false,
				enabled: true,
				inflow: 5200,
				outflow: 1300,
			},
			{
				id: "savings",
				name: "Rainy-day savings",
				external: false,
				enabled: true,
				inflow: 1000,
				outflow: 0,
			},
			{
				id: FLOW_NODE_ID_EXTERNAL,
				name: "External",
				external: true,
				enabled: true,
				inflow: 300,
				outflow: 5200,
			},
		],
		edges: [
			{
				from: FLOW_NODE_ID_EXTERNAL,
				to: "checking",
				kind: "inflow",
				movement: "actual",
				amount: 5000,
				sources: [
					{
						transactionId: "pay-1",
						date: "2026-02-14",
						sequence: 0,
						requestedAmount: 5000,
						realizedAmount: 5000,
					},
				],
			},
			{
				from: "checking",
				to: FLOW_NODE_ID_EXTERNAL,
				kind: "outflow",
				movement: "actual",
				amount: 300,
				sources: [
					{
						transactionId: "rent-1",
						date: "2026-02-01",
						sequence: 0,
						requestedAmount: 300,
						realizedAmount: 300,
					},
				],
			},
			{
				from: "checking",
				to: "savings",
				kind: "transfer",
				movement: "actual",
				amount: 1000,
				sources: [
					{
						transactionId: "sweep-1",
						date: "2026-03-01",
						sequence: 0,
						requestedAmount: 1000,
						realizedAmount: 1000,
					},
				],
			},
			{
				from: FLOW_NODE_ID_EXTERNAL,
				to: "checking",
				kind: "inflow",
				movement: "projected",
				amount: 200,
				sources: [
					{
						transactionId: "rule-pay",
						date: "2026-07-01",
						sequence: 0,
						requestedAmount: 200,
						realizedAmount: 200,
					},
				],
			},
			{
				from: "checking",
				to: "savings",
				kind: "transfer",
				movement: "actual",
				amount: 1,
				sources: [
					{
						transactionId: "dust-1",
						date: "2026-04-01",
						sequence: 0,
						requestedAmount: 1,
						realizedAmount: 1,
					},
				],
			},
			{
				from: "checking",
				to: "savings",
				kind: "transfer",
				movement: "actual",
				amount: 2,
				sources: [
					{
						transactionId: "dust-2",
						date: "2026-05-01",
						sequence: 0,
						requestedAmount: 2,
						realizedAmount: 2,
					},
				],
			},
		],
		unmatched: [],
		unobserved: [],
		coverage: {
			observedAccounts: ["checking", "savings"],
			unobservedAccounts: [],
		},
		totals: {
			actual: { inflow: 5000, outflow: 300, transfer: 1003 },
			projected: { inflow: 200, outflow: 0, transfer: 0 },
			unmatched: 0,
			unobserved: 0,
		},
		reconciliation: {
			windowEvents: 6,
			classifiedEvents: 6,
			unmatchedEvents: 0,
			eventsInflow: 5200,
			eventsOutflow: 300,
			eventsTransfer: 1003,
			edgesInflow: 5200,
			edgesOutflow: 300,
			edgesTransfer: 1003,
			correctionsCount: 0,
			unobservedSum: 0,
			reconciled: true,
		},
	};
}
