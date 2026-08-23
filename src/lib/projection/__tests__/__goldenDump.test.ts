import { mkdirSync, writeFileSync } from "node:fs";
import { describe, it } from "vitest";
import {
	projectFinancialModelDocument,
	projectRawFinancialModelDocument,
} from "@/lib/projection";
import { makeAccount } from "../__fixtures__/accounts";
import { createBaseDocument } from "../__fixtures__/documents";
import { makePosting } from "../__fixtures__/postings";
import type {
	FinancialModelDocument,
	ModelOverrides,
	ProjectionRuntimeSettings,
} from "../types/model";
import type { StochasticConfig } from "../types/stochastic";

// Golden dump harness: when GOLDEN_DUMP_DIR is set this test writes
// request/response pairs produced by the TypeScript engine so the Go port can
// assert parity (docs/backend-migration/ASSUMPTIONS.md A9-A12).

const OUT_DIR = process.env.GOLDEN_DUMP_DIR;

function baseSettings(horizonYears = 1): ProjectionRuntimeSettings {
	return {
		fallbackProjectionStartDate: "2026-02-01",
		horizonYears,
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [
				{
					instanceId: "nw-500",
					label: "Net worth 500",
					enabled: true,
					config: { target: 500 },
				},
			],
			postingFulfillment: [
				{
					instanceId: "pf-all",
					label: "Posting fulfillment",
					enabled: true,
					config: { postingIds: null },
				},
			],
		},
	};
}

function emptyOverrides(): ModelOverrides {
	return {
		addedAccounts: [],
		addedPostings: [],
		disabledAccountIds: [],
		disabledPostingIds: [],
	};
}

describe("golden dump", () => {
	it.skipIf(!OUT_DIR)("writes deterministic golden pairs", () => {
		mkdirSync(OUT_DIR!, { recursive: true });
		const document = createBaseDocument();
		const settings = baseSettings(1);
		const raw = projectRawFinancialModelDocument(
			document,
			settings,
			emptyOverrides(),
		);
		const full = projectFinancialModelDocument(
			document,
			settings,
			emptyOverrides(),
		);
		writeFileSync(
			`${OUT_DIR}/deterministic.json`,
			JSON.stringify(
				{
					document,
					settings,
					overrides: emptyOverrides(),
					path: raw.path,
					result: full,
				},
				null,
				2,
			),
		);
	});

	it.skipIf(!OUT_DIR)("writes checkpoint golden pairs", () => {
		const document = createBaseDocument({
			checkpoints: [
				{ Date: "2026-01-31", AccountId: "checking", Balance: 1500 },
				{ Date: "2026-01-31", AccountId: "loan", Balance: -300 },
			],
		});
		const settings = baseSettings(1);
		const raw = projectRawFinancialModelDocument(
			document,
			settings,
			emptyOverrides(),
		);
		writeFileSync(
			`${OUT_DIR}/checkpoints.json`,
			JSON.stringify(
				{
					document,
					settings,
					overrides: emptyOverrides(),
					path: raw.path,
					result: raw.result,
				},
				null,
				2,
			),
		);
	});

	it.skipIf(!OUT_DIR)("writes stochastic seeded golden pairs", async () => {
		const document: FinancialModelDocument = createBaseDocument({
			postings: [
				makePosting({
					id: "seed_checking",
					destinations: ["checking"],
					arithmetic: "1000",
					frequency: "monthly",
					startDate: "2026-02-01",
					volatility: 0.08,
				}),
				makePosting({
					id: "spend",
					sourceAccountId: "checking",
					arithmetic: "400",
					frequency: "monthly",
					startDate: "2026-02-05",
				}),
			],
			accounts: [
				makeAccount({ id: "checking" }),
				makeAccount({ id: "brokerage" }),
				makeAccount({ id: "loan" }),
			],
		});
		const settings = baseSettings(1);
		const config: StochasticConfig = { runCount: 20, seed: 42 };
		const { stochasticProject } = await import("../analysis/projectStochastic");
		const result = stochasticProject(
			document,
			settings,
			emptyOverrides(),
			config,
		);
		writeFileSync(
			`${OUT_DIR}/stochastic.json`,
			JSON.stringify(
				{
					document,
					settings,
					overrides: emptyOverrides(),
					config,
					result,
				},
				null,
				2,
			),
		);
	});

	it.skipIf(!OUT_DIR)("writes income pipeline golden pairs", async () => {
		const document = createBaseDocument({
			postings: [
				{
					id: "salary",
					label: "Salary",
					sourceAccountId: null,
					destinations: ["checking"],
					amount: {
						resolver: "income",
						config: {
							incomeSourceId: "salary",
							resolvers: [
								{
									resolver: "percentage",
									config: { rate: 0.04, annualCap: 23000 },
									destinationAccountId: "brokerage",
									employerMatchRate: 0.5,
								},
								{
									resolver: "progressive-bracket",
									config: { profileId: "simple" },
									destinationAccountId: null,
								},
							],
						},
						inputs: {},
					},
					frequency: "monthly",
					annualRate: 0,
					annualGrowthRate: 0,
					volatility: 0,
					startDate: "2026-02-05",
					endDate: null,
					annualCap: null,
					priority: 1,
					enabled: true,
				},
				makePosting({
					id: "spend",
					sourceAccountId: "checking",
					arithmetic: "700",
					startDate: "2026-02-06",
					endDate: "2026-02-06",
				}),
			],
		});
		const settings = baseSettings(0) ?? {};
		const horizonSettings: ProjectionRuntimeSettings = {
			...settings,
			evaluations: {
				...settings.evaluations,
				netWorthThreshold: [],
			},
		};
		const incomeData = {
			incomeSources: [
				{
					id: "salary",
					label: "Salary",
					effectiveFrom: "2026-01-01",
					effectiveTo: null,
					annualGrossIncome: 120000,
				},
			],
			taxProfiles: [
				{
					id: "simple",
					label: "Simple",
					deduction: 16100,
					brackets: [
						{ upTo: 24800, rate: 0.1 },
						{ upTo: null, rate: 0.12 },
					],
					sourceUrl: null,
				},
			],
		};
		// Tax step already points at the snapshot profile "simple".
		const full = projectFinancialModelDocument(
			document,
			horizonSettings,
			emptyOverrides(),
			undefined,
			incomeData,
		);
		writeFileSync(
			`${OUT_DIR}/income.json`,
			JSON.stringify(
				{
					document,
					settings: horizonSettings,
					overrides: emptyOverrides(),
					incomeData,
					result: full,
				},
				null,
				2,
			),
		);
	});
});
