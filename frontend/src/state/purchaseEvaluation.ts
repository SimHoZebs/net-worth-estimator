import type {
	EvaluationTables,
	EvaluationResultTables,
	JsonValue,
} from "../api/contracts.ts";
import { isRecord } from "../domain/guards.ts";
import type { PurchaseSchedule } from "../domain/result.ts";

// Request-only evaluation. It neither creates a saved evaluation nor runs FI
// again on this page. The base path keys on plan data alone; this override
// travels in the eval-overlay key, so the cached base simulation is reused
// and only the purchase envelopes refetch.
export const PURCHASE_EVALUATION_ID = "planned-purchases-preview";
export const PURCHASE_EVALUATIONS: EvaluationTables = {
	financialIndependence: [],
	netWorthThreshold: [],
	accountBalance: [],
	postingFulfillment: [],
	cycleFulfillment: [],
	plannedPurchases: [
		{
			instanceId: PURCHASE_EVALUATION_ID,
			name: "Planned purchases",
			enabled: true,
			config: {},
		},
	],
};

export function purchaseSchedule(
	value: JsonValue | undefined,
): PurchaseSchedule | null {
	if (!isRecord(value) || !Array.isArray(value.purchases)) return null;
	const purchases: PurchaseSchedule["purchases"] = [];
	for (const item of value.purchases) {
		if (
			!isRecord(item) ||
			typeof item.postingId !== "string" ||
			(item.date !== null && typeof item.date !== "string") ||
			typeof item.amount !== "number" ||
			!Number.isFinite(item.amount)
		)
			return null;
		purchases.push({
			postingId: item.postingId,
			date: item.date,
			amount: item.amount,
		});
	}
	return { purchases };
}

export function purchaseEvaluationResult(
	results: EvaluationResultTables,
	requested: EvaluationTables | undefined,
): PurchaseSchedule | null {
	if (
		!requested?.plannedPurchases?.some(
			(item) => item.enabled && item.instanceId === PURCHASE_EVALUATION_ID,
		)
	)
		return null;
	const envelope = results.plannedPurchases?.find(
		(item) => item.instanceId === PURCHASE_EVALUATION_ID,
	);
	const schedule =
		envelope &&
		(envelope.status === "satisfied" || envelope.status === "not-satisfied")
			? purchaseSchedule(envelope.deterministic)
			: null;
	if (!schedule)
		throw new Error(
			envelope?.diagnostics.find((item) => item.severity === "error")
				?.message ??
				"The planned purchases evaluation returned no schedule. Retry the calculation.",
		);
	return schedule;
}
