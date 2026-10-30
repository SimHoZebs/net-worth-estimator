import type {
	FinancialModel,
	PostingAmountResolution,
} from "../api/contracts.ts";
import type { Transaction } from "../domain/model.ts";
import {
	financialModelFixture,
	type FinancialModelFixture,
} from "./financialModel.ts";

const stamp = (date: string) =>
	Math.floor(Date.parse(`${date}T00:00:00Z`) / 1000);

export function fixtureAmount(row: Transaction): PostingAmountResolution {
	return row.annualIncrease === 0
		? {
				resolver: "expression",
				config: { expression: String(row.amount) },
				inputs: {},
			}
		: {
				resolver: "expression",
				config: { expression: `${row.amount} * growth` },
				inputs: {
					growth: {
						source: "provider",
						provider: "growth-factor",
						arguments: {
							annualGrowthRate: row.annualIncrease / 100,
							startDate: row.startDate,
						},
					},
				},
			};
}

/** Build the financial model fixture from display rows. */
export function fixtureModel(
	data: FinancialModelFixture = financialModelFixture,
): FinancialModel {
	return {
		sourcePath: "/configs/household.json",
		accounts: data.accounts.map(
			({ id, name, kind, enabled, minBalance, maxBalance, color }) => ({
				id,
				name,
				kind,
				enabled,
				minBalance,
				maxBalance,
				color,
			}),
		),
		checkpoints: data.accounts.map((account) => ({
			observedAt: account.observedAt ?? stamp(account.observedOn) + 86399,
			AccountId: account.id,
			Balance: account.balance,
			source: account.readOnly ? "simplefin" : "user",
		})),
		postings: data.transactions
			.filter((row) => row.frequency === "once")
			.map((row) => ({
				id: row.id,
				name: row.name,
				sourceAccountId: row.fromId,
				destinations: row.toId ? [row.toId] : null,
				amount: fixtureAmount(row),
				postedTime: stamp(row.postedDate ?? row.startDate),
				transactionTime: stamp(row.startDate),
				enabled: row.enabled,
				source: row.readOnly ? "simplefin" : "user",
				pending: row.pending ?? false,
				void: row.void,
				...(row.claimRuleId && row.claimOccurrenceDate
					? {
							claim: {
								ruleId: row.claimRuleId,
								occurrenceDate: row.claimOccurrenceDate,
							},
						}
					: {}),
			})),
		recurrenceRules: data.transactions
			.filter((row) => row.frequency !== "once")
			.map((row, priority) => ({
				id: row.id,
				name: row.name,
				sourceAccountId: row.fromId,
				destinations: row.toId ? [row.toId] : null,
				amount: fixtureAmount(row),
				frequency: row.frequency === "yearly" ? "annual" : "monthly",
				startDate: row.startDate,
				endDate: row.endDate,
				annualCap: null,
				priority,
				enabled: row.enabled,
			})),
		plannedPurchases: data.plannedPurchases.map((row, priority) => ({
			id: row.id,
			name: row.name,
			cost: row.amount,
			fundingAccountId: row.fromId ?? "",
			earliestDate: row.startDate,
			priority,
			enabled: row.enabled,
		})),
		evaluations: {
			financialIndependence: [],
			postingFulfillment: [],
			cycleFulfillment: [],
			netWorthThreshold: data.evaluations
				.filter((row) => row.kind === "net-worth")
				.map((row) => ({
					instanceId: row.id,
					name: row.name,
					enabled: row.enabled,
					config: { target: row.target },
				})),
			accountBalance: data.evaluations
				.filter((row) => row.kind === "reserve")
				.map((row) => ({
					instanceId: row.id,
					name: row.name,
					enabled: row.enabled,
					config: { accountId: row.accountId, target: row.target },
				})),
		},
	};
}
