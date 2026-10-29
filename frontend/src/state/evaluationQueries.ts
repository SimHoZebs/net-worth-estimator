import { finite, isRecord } from "@/domain/guards.ts";
import type { Evaluation } from "@/domain/model.ts";
import type { EvaluationSummary } from "./workspaceResources.ts";

export {
	evalSummaryOptions,
	getEvaluationSummary,
	useEvaluationSummary,
	type EvaluationSummary,
} from "./workspaceResources.ts";

function targetFromConfig(config: unknown): number {
	return finite(isRecord(config) ? config.target : undefined) ?? 0;
}

function accountFromConfig(config: unknown): string | null {
	if (!isRecord(config)) return null;
	return typeof config.accountId === "string" ? config.accountId : null;
}

/** Saved threshold and reserve rows as display evaluations for the grids. */
export function summaryEvaluations(
	summary: EvaluationSummary | undefined,
): Evaluation[] {
	if (!summary) return [];
	const thresholds = summary.evaluations.netWorthThreshold.map(
		(row): Evaluation => ({
			id: row.instanceId,
			name: row.name || row.instanceId,
			kind: "net-worth",
			target: targetFromConfig(row.config),
			accountId: null,
			enabled: row.enabled,
		}),
	);
	const reserves = summary.evaluations.accountBalance.map(
		(row): Evaluation => ({
			id: row.instanceId,
			name: row.name || row.instanceId,
			kind: "reserve",
			target: targetFromConfig(row.config),
			accountId: accountFromConfig(row.config),
			enabled: row.enabled,
		}),
	);
	return [...thresholds, ...reserves];
}

/** Every saved evaluation instance across the five instance tables. */
export function summaryInstanceIds(
	summary: EvaluationSummary | undefined,
): Set<string> {
	const ids = new Set<string>();
	if (!summary) return ids;
	for (const row of summary.evaluations.financialIndependence)
		ids.add(row.instanceId);
	for (const row of summary.evaluations.netWorthThreshold)
		ids.add(row.instanceId);
	for (const row of summary.evaluations.accountBalance) ids.add(row.instanceId);
	for (const row of summary.evaluations.postingFulfillment)
		ids.add(row.instanceId);
	for (const row of summary.evaluations.cycleFulfillment ?? [])
		ids.add(row.instanceId);
	return ids;
}
