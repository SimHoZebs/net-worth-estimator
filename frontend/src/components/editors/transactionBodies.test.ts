import { describe, expect, it } from "vitest";
import { NO_CEILING_SENTINEL } from "../../api/contracts.ts";
import type { Posting, RecurrenceRule } from "../../api/contracts.ts";
import type { Account, Transaction } from "../../domain/model.ts";
import { accountUpdateBody } from "./accountFields.ts";
import {
	combineDayTime,
	detailFormValues,
	timeOfDay,
	claimPostingBody,
	postingUpdateBody,
	ruleUpdateBody,
} from "./transactionBodies.ts";

const baselinePosting: Transaction = {
	id: "renovation",
	name: "Home renovation",
	amount: 48000,
	amountKnown: true,
	fromId: "checking",
	toId: "savings",
	frequency: "once",
	startDate: "2028-06-15",
	endDate: null,
	annualIncrease: 0,
	enabled: true,
	readOnly: false,
	claimRuleId: null,
	claimOccurrenceDate: null,
	postedDate: "2028-06-15",
	void: false,
};

// Raw row with server shapes the display never carries: non-midnight
// seconds, a custom resolver with extra inputs,
// and multiple destination legs.
const rawPosting: Posting = {
	id: "renovation",
	name: "Home renovation",
	sourceAccountId: "checking",
	destinations: ["savings", "brokerage"],
	amount: {
		resolver: "custom-split",
		config: { expression: "48000", locale: "en-US" },
		inputs: {
			extra: {
				source: "provider",
				provider: "fx-rate",
				arguments: { pair: "USD/EUR" },
			},
		},
	},
	postedTime: 1842681845,
	transactionTime: 1842637212,
	claim: null,
	enabled: true,
};

describe("posting update bodies", () => {
	it("preserves second precision through the detail form and honors an explicit new time", () => {
		const item = {
			...baselinePosting,
			transactionTime: rawPosting.transactionTime,
		};
		const draft = {
			name: "Renamed",
			amount: "48000",
			fromId: "checking",
			toId: "savings",
			frequency: "once" as const,
			startDate: item.startDate,
			endDate: "",
			noEndDate: true,
			annualIncrease: "0",
			enabled: true,
			claimRuleId: "",
			claimOccurrenceDate: "",
			postedDate: item.postedDate ?? "",
			transactionTime: timeOfDay(item.transactionTime),
		};
		const values = detailFormValues({ draft, item, isOnce: true });
		if (values instanceof Error) throw values;
		expect(
			postingUpdateBody({ baseline: item, raw: rawPosting, values })
				.transactionTime,
		).toBe(rawPosting.transactionTime);
		const changed = {
			...values,
			transactionTime: combineDayTime(item.startDate, "11:00"),
		};
		expect(
			postingUpdateBody({ baseline: item, raw: rawPosting, values: changed })
				.transactionTime,
		).toBe(changed.transactionTime);
	});
	it("preserves raw timestamps, amount, and destinations on a rename-only edit", () => {
		const body = postingUpdateBody({
			baseline: baselinePosting,
			raw: rawPosting,
			values: {
				name: "Home renovation revised",
				amount: 48000,
				annualIncrease: 0,
				fromId: "checking",
				toId: "savings",
				frequency: "once",
				startDate: "2028-06-15",
				endDate: null,
				postedDate: "2028-06-15",
				enabled: true,
				claimRuleId: null,
				claimOccurrenceDate: null,
			},
		});
		expect(body).toEqual({
			name: "Home renovation revised",
			amount: rawPosting.amount,
			enabled: true,
			sourceAccountId: "checking",
			destinations: ["savings", "brokerage"],
			postedTime: 1842681845,
			transactionTime: 1842637212,
		});
	});

	it("rebuilds only the edited timestamp, amount, and endpoints", () => {
		const body = postingUpdateBody({
			baseline: baselinePosting,
			raw: rawPosting,
			values: {
				name: "Home renovation",
				amount: 50000,
				annualIncrease: 0,
				fromId: null,
				toId: "savings",
				frequency: "once",
				startDate: "2028-06-20",
				endDate: null,
				postedDate: "2028-06-15",
				enabled: false,
				claimRuleId: null,
				claimOccurrenceDate: null,
			},
		});
		expect(body.amount).toEqual({
			resolver: "expression",
			config: { expression: "50000" },
			inputs: {},
		});
		// Unchanged posted day keeps its exact time; the moved start day is
		// restated at midnight.
		expect(body.postedTime).toBe(1842681845);
		expect(body.transactionTime).toBe(
			Math.floor(new Date("2028-06-20T00:00:00Z").getTime() / 1000),
		);
		expect(body.sourceAccountId).toBeUndefined();
		expect(body.destinations).toEqual(["savings"]);
		expect(body.enabled).toBe(false);
	});

	it("restates stored claims unless the edit changes the link", () => {
		const claimed: Posting = {
			...rawPosting,
			claim: { ruleId: "reno-sub", occurrenceDate: "2028-06-15" },
		};
		const kept = postingUpdateBody({
			baseline: {
				...baselinePosting,
				claimRuleId: "reno-sub",
				claimOccurrenceDate: "2028-06-15",
			},
			raw: claimed,
			values: {
				name: "Renamed",
				amount: 48000,
				annualIncrease: 0,
				fromId: "checking",
				toId: "savings",
				frequency: "once",
				startDate: "2028-06-15",
				endDate: null,
				postedDate: "2028-06-15",
				enabled: true,
				claimRuleId: "reno-sub",
				claimOccurrenceDate: "2028-06-15",
			},
		});
		expect(kept.claim).toEqual({
			ruleId: "reno-sub",
			occurrenceDate: "2028-06-15",
		});
		const cleared = postingUpdateBody({
			baseline: {
				...baselinePosting,
				claimRuleId: "reno-sub",
				claimOccurrenceDate: "2028-06-15",
			},
			raw: claimed,
			values: {
				name: "Renamed",
				amount: 48000,
				annualIncrease: 0,
				fromId: "checking",
				toId: "savings",
				frequency: "once",
				startDate: "2028-06-15",
				endDate: null,
				postedDate: "2028-06-15",
				enabled: true,
				claimRuleId: null,
				claimOccurrenceDate: null,
			},
		});
		expect(cleared.claim).toBeUndefined();
	});
});

describe("claim posting bodies", () => {
	it("changes only the claim on the original raw row", () => {
		const body = claimPostingBody(rawPosting, "reno-sub", "2028-06-15");
		expect(body).toEqual({
			name: "Home renovation",
			amount: rawPosting.amount,
			enabled: true,
			sourceAccountId: "checking",
			destinations: ["savings", "brokerage"],
			postedTime: 1842681845,
			transactionTime: 1842637212,
			claim: { ruleId: "reno-sub", occurrenceDate: "2028-06-15" },
		});
	});
});

const baselineRule: Transaction = {
	id: "invest",
	name: "Monthly investing",
	amount: 1800,
	amountKnown: true,
	fromId: "checking",
	toId: "brokerage",
	frequency: "yearly",
	startDate: "2026-10-03",
	endDate: "2028-10-03",
	annualIncrease: 0,
	enabled: true,
	readOnly: false,
	claimRuleId: null,
	claimOccurrenceDate: null,
	postedDate: null,
	void: false,
};

const rawRule: RecurrenceRule = {
	id: "invest",
	name: "Monthly investing",
	sourceAccountId: "checking",
	destinations: ["brokerage"],
	amount: {
		resolver: "custom-tiered",
		config: { expression: "1800" },
		inputs: {
			tier: {
				source: "provider",
				provider: "balance-tier",
				arguments: { accountId: "checking" },
			},
		},
	},
	frequency: "annual",
	startDate: "2026-10-03",
	endDate: "2028-10-03",
	annualCap: 50000,
	priority: 7,
	enabled: true,
};

describe("rule update bodies", () => {
	it("preserves raw frequency, cap, priority, and amount on a rename-only edit", () => {
		const body = ruleUpdateBody({
			baseline: baselineRule,
			raw: rawRule,
			values: {
				name: "Monthly investing revised",
				amount: 1800,
				annualIncrease: 0,
				fromId: "checking",
				toId: "brokerage",
				frequency: "yearly",
				startDate: "2026-10-03",
				endDate: "2028-10-03",
				postedDate: null,
				enabled: true,
				claimRuleId: null,
				claimOccurrenceDate: null,
			},
		});
		expect(body).toEqual({
			name: "Monthly investing revised",
			amount: rawRule.amount,
			enabled: true,
			frequency: "annual",
			startDate: "2026-10-03",
			endDate: "2028-10-03",
			annualCap: 50000,
			priority: 7,
			sourceAccountId: "checking",
			destinations: ["brokerage"],
		});
	});

	it("rebuilds edited amount and frequency while keeping cap and priority", () => {
		const body = ruleUpdateBody({
			baseline: baselineRule,
			raw: rawRule,
			values: {
				name: "Monthly investing",
				amount: 2000,
				annualIncrease: 3,
				fromId: "checking",
				toId: "brokerage",
				frequency: "monthly",
				startDate: "2026-10-03",
				endDate: null,
				postedDate: null,
				enabled: true,
				claimRuleId: null,
				claimOccurrenceDate: null,
			},
		});
		expect(body.amount).toEqual({
			resolver: "expression",
			config: { expression: "(2000) * growth" },
			inputs: {
				growth: {
					source: "provider",
					provider: "growth-factor",
					arguments: { annualGrowthRate: 0.03 },
				},
			},
		});
		expect(body.frequency).toBe("monthly");
		expect(body.endDate).toBeUndefined();
		expect(body.annualCap).toBe(50000);
		expect(body.priority).toBe(7);
	});

	it("saves an edited first occurrence without changing untouched rule fields", () => {
		const body = ruleUpdateBody({
			baseline: baselineRule,
			raw: rawRule,
			values: { ...baselineRule, startDate: "2026-11-15" },
		});
		expect(body.startDate).toBe("2026-11-15");
		expect(body.amount).toEqual(rawRule.amount);
		expect(body.annualCap).toBe(rawRule.annualCap);
		expect(body.priority).toBe(rawRule.priority);
	});
});

const baselineAccount: Account = {
	id: "home",
	name: "Home value",
	kind: "property",
	enabled: true,
	archived: false,
	balance: 480000,
	minBalance: 0,
	maxBalance: null,
	color: null,
	observedOn: "2026-09-01",
	balanceCheck: false,
	source: "Backend account",
	readOnly: false,
};

describe("account update bodies", () => {
	it("omits a null raw floor instead of inventing zero on a name-only edit", () => {
		const body = accountUpdateBody({
			baseline: baselineAccount,
			raw: {
				id: "home",
				name: "Home value",
				kind: "property",
				minBalance: null,
				maxBalance: null,
				color: null,
				enabled: true,
			},
			values: {
				name: "Home value revised",
				kind: "property",
				enabled: true,
				balance: 480000,
				minBalance: 0,
				maxBalance: null,
				noCeiling: true,
			},
		});
		expect(body.name).toBe("Home value revised");
		expect(body).not.toHaveProperty("minBalance");
		expect(body).not.toHaveProperty("maxBalance");
	});

	it("keeps raw negative floors and sentinels verbatim on a name-only edit", () => {
		const body = accountUpdateBody({
			baseline: baselineAccount,
			raw: {
				id: "home",
				name: "Home value",
				kind: "property",
				minBalance: -2500,
				maxBalance: NO_CEILING_SENTINEL,
				color: "#a16207",
				enabled: true,
			},
			values: {
				name: "Home value revised",
				kind: "property",
				enabled: true,
				balance: 480000,
				minBalance: 0,
				maxBalance: null,
				noCeiling: true,
			},
		});
		expect(body.minBalance).toBe(-2500);
		expect(body.maxBalance).toBe(NO_CEILING_SENTINEL);
		expect(body.color).toBe("#a16207");
	});

	it("writes edited bounds and clears the ceiling when selected", () => {
		const edited = accountUpdateBody({
			baseline: { ...baselineAccount, minBalance: 0, maxBalance: 600000 },
			raw: {
				id: "home",
				name: "Home value",
				kind: "property",
				minBalance: null,
				maxBalance: 600000,
				color: null,
				enabled: true,
			},
			values: {
				name: "Home value",
				kind: "property",
				enabled: true,
				balance: 480000,
				minBalance: 5000,
				maxBalance: null,
				noCeiling: true,
			},
		});
		expect(edited.minBalance).toBe(5000);
		expect(edited).not.toHaveProperty("maxBalance");
		const capped = accountUpdateBody({
			baseline: { ...baselineAccount, minBalance: 5000 },
			raw: {
				id: "home",
				name: "Home value",
				kind: "property",
				minBalance: null,
				maxBalance: null,
				color: null,
				enabled: true,
			},
			values: {
				name: "Home value",
				kind: "property",
				enabled: true,
				balance: 480000,
				minBalance: 5000,
				maxBalance: 600000,
				noCeiling: false,
			},
		});
		expect(capped).not.toHaveProperty("minBalance");
		expect(capped.maxBalance).toBe(600000);
	});
});
