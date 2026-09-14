import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCsvFinancialModel } from "../sources/csv/csvLoader";
import { validateCsvFinancialModel } from "../sources/csv/csvValidation";
import {
	parseIncomeDataFiles,
	parseIncomeDataSnapshot,
} from "../sources/csv/incomeDataSource";
import type { ModelFileContents } from "../types/model";

const incomeSources = [
	"id,label,effectiveFrom,effectiveTo,annualGrossIncome",
	"salary,Salary,2026-01-01,,120000",
].join("\n");
const taxProfiles = [
	"id,label,deduction,brackets,sourceUrl",
	'us-federal,US federal,10000,"[{""upTo"":50000,""rate"":0.1},{""upTo"":null,""rate"":0.2}]",https://example.com/tax',
].join("\n");

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

	it("parses a backend JSON snapshot identically to the CSV files", () => {
		const fromCsv = parseIncomeDataFiles({ incomeSources, taxProfiles });
		expect(fromCsv.issues).toEqual([]);
		if (!fromCsv.data) throw new Error("Expected valid income data.");
		const fromSnapshot = parseIncomeDataSnapshot(
			JSON.parse(JSON.stringify(fromCsv.data)),
		);
		expect(fromSnapshot.issues).toEqual([]);
		expect(fromSnapshot.data).toEqual(fromCsv.data);
	});

	it("rejects a malformed snapshot shape", () => {
		const result = parseIncomeDataSnapshot({ incomeSources: null });
		expect(result.data).toBeNull();
		expect(
			result.issues.some(
				(issue) => issue.code === "income-data.snapshot.invalid",
			),
		).toBe(true);
	});

	it("reports invalid snapshot rows without a CSV roundtrip", () => {
		const result = parseIncomeDataSnapshot({
			incomeSources: [
				{
					id: "salary",
					label: "Salary",
					effectiveFrom: "2026-02-31",
					effectiveTo: null,
					annualGrossIncome: 120000,
				},
			],
			taxProfiles: [],
		});
		expect(result.data).toBeNull();
		expect(
			result.issues.some((issue) => issue.code === "income-data.row.invalid"),
		).toBe(true);
	});

	it("accepts the bundled income posting with the bundled source data", async () => {
		const read = (path: string) =>
			readFile(new URL(`../../../../${path}`, import.meta.url), "utf8");
		const [
			accounts,
			checkpoints,
			postings,
			financialIndependence,
			netWorthThreshold,
			postingFulfillment,
			bundledIncomeSources,
			bundledTaxProfiles,
		] = await Promise.all([
			read("public/configs/accounts.csv"),
			read("public/configs/checkpoints.csv"),
			read("public/configs/postings.csv"),
			read("public/configs/behavior/financial-independence.csv"),
			read("public/configs/behavior/net-worth-threshold.csv"),
			read("public/configs/behavior/posting-fulfillment.csv"),
			read("public/data/income/income-sources.csv"),
			read("public/data/income/tax-profiles.csv"),
		]);
		const modelResult = parseCsvFinancialModel({
			accounts,
			checkpoints,
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
