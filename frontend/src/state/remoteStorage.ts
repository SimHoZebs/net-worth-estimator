import type { FinancialModelDocument } from "../api/index.ts";

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

export function serverDocumentFingerprint(
	document: FinancialModelDocument,
): string {
	const semanticDocument = {
		sourcePath: document.sourcePath,
		accounts: document.accounts.map(
			({ id, name, minBalance, maxBalance, color, enabled }) => ({
				id,
				name,
				minBalance,
				maxBalance,
				color,
				enabled,
			}),
		),
		checkpoints: document.checkpoints.map(
			({ Date: date, AccountId, Balance, source }) => ({
				Date: date,
				AccountId,
				Balance,
				...(source === undefined ? {} : { source }),
			}),
		),
		evaluations: {
			financialIndependence: document.evaluations.financialIndependence.map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
			netWorthThreshold: document.evaluations.netWorthThreshold.map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
			accountBalance: document.evaluations.accountBalance.map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
			postingFulfillment: document.evaluations.postingFulfillment.map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
			cycleFulfillment: (document.evaluations.cycleFulfillment ?? []).map(
				({ instanceId, name, enabled, config }) => ({
					instanceId,
					name,
					enabled,
					config,
				}),
			),
		},
		postings: document.postings.map(
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
		recurrenceRules: (document.recurrenceRules ?? []).map(
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
	return `v1:${stableHash(canonicalJson(semanticDocument))}`;
}
