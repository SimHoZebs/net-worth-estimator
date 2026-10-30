import type { FinancialModel } from "../api/index.ts";

function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string") return JSON.stringify(value);
	if (typeof value === "boolean") return value ? "true" : "false";
	if (typeof value === "number")
		return Object.is(value, -0) ? "0" : String(value);
	if (Array.isArray(value))
		return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		const fields = Object.keys(record)
			.filter((key) => record[key] !== undefined)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
		return `{${fields.join(",")}}`;
	}
	return "null";
}

function stableHash(value: string): string {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

export function serverModelFingerprint(model: FinancialModel): string {
	const semanticModel = {
		sourcePath: model.sourcePath,
		accounts: model.accounts.map(
			({ id, name, minBalance, maxBalance, color, enabled }) => ({
				id,
				name,
				minBalance,
				maxBalance,
				color,
				enabled,
			}),
		),
		checkpoints: model.checkpoints.map(
			({ AccountId, Balance, source, observedAt }) => ({
				AccountId,
				Balance,
				observedAt,
				...(source === undefined ? {} : { source }),
			}),
		),
		evaluations: {
			financialIndependence: model.evaluations.financialIndependence.map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
			netWorthThreshold: model.evaluations.netWorthThreshold.map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
			accountBalance: model.evaluations.accountBalance.map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
			postingFulfillment: model.evaluations.postingFulfillment.map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
			cycleFulfillment: (model.evaluations.cycleFulfillment ?? []).map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
		},
		postings: model.postings.map(
			({
				id,
				name,
				sourceAccountId,
				destinations,
				amount,
				postedTime,
				transactionTime,
				claim,
				enabled,
				source,
			}) => ({
				id,
				name,
				sourceAccountId,
				destinations,
				amount,
				postedTime,
				transactionTime,
				claim,
				enabled,
				...(source === undefined ? {} : { source }),
			}),
		),
		recurrenceRules: (model.recurrenceRules ?? []).map(
			({
				id,
				name,
				sourceAccountId,
				destinations,
				amount,
				frequency,
				startDate,
				endDate,
				annualCap,
				priority,
				enabled,
			}) => ({
				id,
				name,
				sourceAccountId,
				destinations,
				amount,
				frequency,
				startDate,
				endDate,
				annualCap,
				priority,
				enabled,
			}),
		),
	};
	return `v1:${stableHash(canonicalJson(semanticModel))}`;
}
