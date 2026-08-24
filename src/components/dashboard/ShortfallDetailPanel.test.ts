import { describe, expect, it } from "vitest";
import type {
	Account,
	Posting,
	PostingFulfillmentEvent,
	ProjectionRow,
} from "@/lib/projection";
import { makeAccount } from "@/lib/projection/__fixtures__/accounts";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import { buildShortfallCascadeViewModel } from "./ShortfallDetailPanel";

const PERIOD_START = "2026-02-01";

function account(id: string, label = id): Account {
	return makeAccount({
		id,
		label,
		minBalance: 0,
		maxBalance: Number.POSITIVE_INFINITY,
	});
}

function posting(id: string, sourceAccountId: string | null = null): Posting {
	return makePosting({
		id,
		label: `Posting ${id}`,
		sourceAccountId,
		startDate: PERIOD_START,
		priority: 0,
	});
}

function event(
	postingId: string,
	sequence: number,
	overrides: Partial<PostingFulfillmentEvent> = {},
): PostingFulfillmentEvent {
	return {
		date: PERIOD_START,
		sequence,
		postingId,
		requestedAmount: 10,
		realizedAmount: 10,
		destinationLimitedAmount: 0,
		unfulfilledAmount: 0,
		bindingConstraints: [],
		accountDeltas: [{ accountId: "checking", delta: 10 }],
		...overrides,
	};
}

function row(date: string, balances: Record<string, number>): ProjectionRow {
	return {
		date,
		isHistorical: false,
		netWorth: Object.values(balances).reduce(
			(sum, balance) => sum + balance,
			0,
		),
		accountSnapshots: Object.entries(balances).map(([accountId, balance]) => ({
			accountId,
			date,
			balance,
			impacts: [],
		})),
		externalInflowAmount: 0,
		externalOutflowAmount: 0,
		internalTransferAmount: 0,
	};
}

function build({
	events,
	accounts = [account("checking")],
	postings,
	rows = [],
}: {
	events: PostingFulfillmentEvent[];
	accounts?: Account[];
	postings?: Posting[];
	rows?: ProjectionRow[];
}) {
	const postingById = Object.fromEntries(
		(postings ?? events.map(({ postingId }) => posting(postingId))).map(
			(item) => [item.id, item],
		),
	);
	return buildShortfallCascadeViewModel({
		periodStartDate: PERIOD_START,
		events,
		rows,
		postingById,
		accounts,
	});
}

describe("buildShortfallCascadeViewModel", () => {
	it("orders cascade steps by event sequence without mutating the input", () => {
		const events = [event("later", 20), event("earlier", 10)];

		const result = build({ events });

		expect(
			result.cascadeStepsByAccount
				.get("checking")
				?.map(({ postingId }) => postingId),
		).toEqual(["earlier", "later"]);
		expect(events.map(({ postingId }) => postingId)).toEqual([
			"later",
			"earlier",
		]);
	});

	it("adds a zero-delta step for a constrained account with no delta", () => {
		const result = build({
			events: [
				event("rent", 1, {
					bindingConstraints: [{ type: "source-floor", accountId: "savings" }],
				}),
			],
			accounts: [account("checking"), account("savings")],
		});

		expect(result.cascadeStepsByAccount.get("savings")).toMatchObject([
			{
				postingId: "rent",
				delta: 0,
				constraints: ["source-floor"],
			},
		]);
	});

	it("calculates running balances from the prior projection row", () => {
		const result = build({
			events: [
				event("deposit", 1, {
					accountDeltas: [{ accountId: "checking", delta: 20 }],
				}),
				event("withdrawal", 2, {
					accountDeltas: [{ accountId: "checking", delta: -5 }],
				}),
			],
			rows: [
				row("2026-01-01", { checking: 100 }),
				row(PERIOD_START, { checking: 115 }),
			],
		});

		expect(
			result.cascadeStepsByAccount
				.get("checking")
				?.map(({ runningBalance }) => runningBalance),
		).toEqual([120, 115]);
	});

	it("falls back to the posting source account when no constraint owns the shortfall", () => {
		const result = build({
			events: [
				event("rent", 1, {
					unfulfilledAmount: 10,
					bindingConstraints: [{ type: "action-limit" }],
					accountDeltas: [{ accountId: "landlord", delta: 5 }],
				}),
			],
			accounts: [account("source"), account("landlord")],
			postings: [posting("rent", "source")],
		});

		expect(result.cascadeStepsByAccount.get("source")).toMatchObject([
			{ postingId: "rent", delta: 0, isShortfall: true },
		]);
		expect(result.cascadeAccounts.map(({ id }) => id)).toEqual([
			"source",
			"landlord",
		]);
	});

	it("orders constrained accounts first and each group by label", () => {
		const accounts = [
			account("unconstrained", "Beta"),
			account("constrained-z", "Zulu"),
			account("constrained-a", "Alpha"),
			account("unconstrained-a", "Able"),
		];
		const result = build({
			events: [
				event("transfer", 1, {
					accountDeltas: accounts.map(({ id }) => ({
						accountId: id,
						delta: 1,
					})),
					bindingConstraints: [
						{
							type: "destination-ceiling",
							accountIds: ["constrained-z", "constrained-a"],
						},
					],
				}),
			],
			accounts,
		});

		expect(result.cascadeAccounts.map(({ id }) => id)).toEqual([
			"constrained-a",
			"constrained-z",
			"unconstrained-a",
			"unconstrained",
		]);
	});
});
