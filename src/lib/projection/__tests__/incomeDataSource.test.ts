import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { projectRawFinancialModelDocument } from "../simulation/projectPath";
import { parseCsvFinancialModel } from "../sources/csv/csvLoader";
import { validateCsvFinancialModel } from "../sources/csv/csvValidation";
import { parseIncomeDataFiles } from "../sources/csv/incomeDataSource";
import type { IncomeDataSnapshot } from "../types/income";
import type { FinancialModelDocument, ModelFileContents } from "../types/model";

const incomeSources = [
	"id,label,effectiveFrom,effectiveTo,annualGrossIncome",
	"salary,Salary,2026-01-01,,120000",
].join("\n");
const taxProfiles = [
	"id,label,deduction,brackets,sourceUrl",
	'us-federal,US federal,10000,"[{""upTo"":50000,""rate"":0.1},{""upTo"":null,""rate"":0.2}]",https://example.com/tax',
].join("\n");

function makeDocument(): FinancialModelDocument {
	return {
		sourcePath: "test",
		accounts: [
			{
				id: "checking",
				label: "Checking",
				minBalance: Number.NEGATIVE_INFINITY,
				maxBalance: Number.POSITIVE_INFINITY,
				color: null,
				enabled: true,
			},
			{
				id: "k401",
				label: "401(k)",
				minBalance: Number.NEGATIVE_INFINITY,
				maxBalance: Number.POSITIVE_INFINITY,
				color: null,
				enabled: true,
			},
		],
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [],
			postingFulfillment: [],
		},
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
								config: { rate: 0.1, annualCap: null },
								destinationAccountId: "k401",
								employerMatchRate: 0.5,
							},
							{
								resolver: "progressive-bracket",
								config: { profileId: "us-federal" },
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
				startDate: "2026-01-01",
				endDate: "2026-01-01",
				annualCap: null,
				priority: 1,
				enabled: true,
			},
		],
	};
}

describe("income data source and income posting", () => {
	it("parses income and tax CSV data", () => {
		const result = parseIncomeDataFiles({ incomeSources, taxProfiles });
		expect(result.issues).toEqual([]);
		expect(result.data?.incomeSources[0]?.annualGrossIncome).toBe(120000);
		expect(result.data?.taxProfiles[0]?.brackets).toHaveLength(2);
	});

	it("rejects invalid dates and non-final open-ended tax brackets", () => {
		const result = parseIncomeDataFiles({
			incomeSources: [
				"id,label,effectiveFrom,effectiveTo,annualGrossIncome",
				"salary,Salary,2026-02-31,,120000",
			].join("\n"),
			taxProfiles: [
				"id,label,deduction,brackets,sourceUrl",
				'us-federal,US federal,10000,"[{""upTo"":null,""rate"":0.1},{""upTo"":null,""rate"":0.2}]",https://example.com/tax',
			].join("\n"),
		});
		expect(result.data).toBeNull();
		expect(
			result.issues.some((issue) => issue.code === "income-data.row.invalid"),
		).toBe(true);
		expect(
			result.issues.some(
				(issue) => issue.code === "income-data.tax-profile.brackets",
			),
		).toBe(true);
	});

	it("runs ordered payroll resolvers and settles net, contribution, and match", () => {
		const data = parseIncomeDataFiles({ incomeSources, taxProfiles }).data;
		if (!data) throw new Error("Expected valid income data.");
		const result = projectRawFinancialModelDocument(
			makeDocument(),
			{
				fallbackProjectionStartDate: "2026-01-01",
				horizonYears: 1,
				evaluations: {
					financialIndependence: [],
					netWorthThreshold: [],
					postingFulfillment: [],
				},
			},
			undefined,
			undefined,
			data as IncomeDataSnapshot,
		);
		const event = result.path.movementEvents[0];
		expect(event?.realizedAmount).toBeCloseTo(7_783.333333);
		expect(event?.income?.resolvers[0]?.realizedAmount).toBeCloseTo(1_000);
		expect(event?.income?.resolvers[1]?.realizedAmount).toBeCloseTo(
			1_216.666667,
		);
		expect(event?.income?.employerMatchRealized).toBeCloseTo(500);
		expect(
			result.path.rows[0]?.accountSnapshots.find(
				(row) => row.accountId === "checking",
			)?.balance,
		).toBeCloseTo(7_783.333333);
		expect(
			result.path.rows[0]?.accountSnapshots.find(
				(row) => row.accountId === "k401",
			)?.balance,
		).toBeCloseTo(1_500);
	});

	it("spreads a resolver annual cap across recurring occurrences", () => {
		const data = parseIncomeDataFiles({ incomeSources, taxProfiles }).data;
		if (!data) throw new Error("Expected valid income data.");
		const document = makeDocument();
		const posting = document.postings[0]!;
		posting.startDate = "2026-01-01";
		posting.endDate = "2026-12-01";
		const firstResolver = (
			posting.amount.config.resolvers as Array<{
				config: Record<string, unknown>;
			}>
		)[0]!;
		firstResolver.config.rate = 1;
		firstResolver.config.annualCap = 23_000;
		const result = projectRawFinancialModelDocument(
			document,
			{
				fallbackProjectionStartDate: "2026-01-01",
				horizonYears: 1,
				evaluations: {
					financialIndependence: [],
					netWorthThreshold: [],
					postingFulfillment: [],
				},
			},
			undefined,
			undefined,
			data,
		);
		const contributionTotal = result.path.movementEvents.reduce(
			(total, event) =>
				total + (event.income?.resolvers[0]?.realizedAmount ?? 0),
			0,
		);
		expect(contributionTotal).toBeCloseTo(23_000);
	});

	it("accepts the bundled income posting with the bundled source data", async () => {
		const read = (path: string) =>
			readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");
		const [
			accounts,
			postings,
			financialIndependence,
			netWorthThreshold,
			postingFulfillment,
			bundledIncomeSources,
			bundledTaxProfiles,
		] = await Promise.all([
			read("public/configs/accounts.csv"),
			read("public/configs/postings.csv"),
			read("public/configs/behavior/financial-independence.csv"),
			read("public/configs/behavior/net-worth-threshold.csv"),
			read("public/configs/behavior/posting-fulfillment.csv"),
			read("public/data/income/income-sources.csv"),
			read("public/data/income/tax-profiles.csv"),
		]);
		const modelResult = parseCsvFinancialModel({
			accounts,
			postings,
			behaviors: {
				financialIndependence,
				netWorthThreshold,
				postingFulfillment,
			},
		} satisfies ModelFileContents);
		const dataResult = parseIncomeDataFiles({
			incomeSources: bundledIncomeSources,
			taxProfiles: bundledTaxProfiles,
		});
		if (!modelResult.data || !dataResult.data) {
			throw new Error("Expected bundled model and income data to parse.");
		}
		const errors = validateCsvFinancialModel(
			modelResult.data,
			dataResult.data,
		).filter((issue) => issue.severity === "error");
		expect(errors).toEqual([]);
		expect(
			modelResult.data.postings.find((posting) => posting.id === "salary")
				?.amount.resolver,
		).toBe("income");
		expect(
			modelResult.data.postings.some((posting) => posting.id === "taxes"),
		).toBe(false);
	});
});
