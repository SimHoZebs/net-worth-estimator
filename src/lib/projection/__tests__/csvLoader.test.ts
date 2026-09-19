import { describe, expect, it } from "vitest";
import {
	CSV_MODEL_PUBLIC_PATH,
	createExpressionAmount,
	getExpression,
	parseCsvFinancialModel,
} from "../";
import {
	nullMinMaxCsvFiles,
	postingsHeaderOnly,
	validCsvFiles,
} from "../__fixtures__";

function csvExpressionAmount(expression: string): string {
	return `"${JSON.stringify(createExpressionAmount(expression)).replace(/"/g, '""')}"`;
}

describe("CSV financial model", () => {
	it("rejects legacy and mixed posting schemas", () => {
		const files = {
			...validCsvFiles,
			postings:
				"id,label,sourceAccountId,destinations,arithmetic,amount,frequency,annualRate,annualGrowthRate,volatility,startDate,endDate,annualCap,priority,enabled\nlegacy,Legacy,,checking,100,{},monthly,0,0,0,2026-01-01,,,1,true",
		};

		const result = parseCsvFinancialModel(files);
		expect(result.data).toBeNull();
		expect(
			result.issues.some((issue) => issue.code === "csv.headers.unexpected"),
		).toBe(true);
	});

	it("rejects malformed canonical amount JSON", () => {
		const postings = [
			"id,label,sourceAccountId,destinations,amount,frequency,annualRate,annualGrowthRate,volatility,startDate,endDate,annualCap,priority,enabled",
			"invalid,Invalid,,checking,{bad,once,0,0,0,2026-01-01,,,1,true",
		].join("\n");
		const result = parseCsvFinancialModel({ ...validCsvFiles, postings });

		expect(result.data).toBeNull();
		expect(
			result.issues.some((issue) => issue.code === "csv.row.invalid"),
		).toBe(true);
	});

	it("parses a valid CSV financial model", () => {
		const result = parseCsvFinancialModel(validCsvFiles, {
			basePath: CSV_MODEL_PUBLIC_PATH,
		});

		expect(result.issues).toEqual([]);
		expect(result.data?.sourcePath).toBe(CSV_MODEL_PUBLIC_PATH);
		expect(result.data?.checkpoints).toEqual([]);
		expect(result.data?.postings[0]?.frequency).toBe("once");
		expect(
			result.data?.postings[5] && getExpression(result.data.postings[5]),
		).toBe("salary * 0.22");
		expect(result.data?.postings[7]?.annualCap).toBe(23000);
		expect(result.data?.accounts[3]?.label).toBe("Student Loan");
		expect(result.data?.evaluations.netWorthThreshold[0]?.config).toEqual({
			target: 1_000_000,
		});
	});

	it("rejects invalid typed evaluation fields and duplicate instance IDs", () => {
		const invalidJson = parseCsvFinancialModel({
			...validCsvFiles,
			behaviors: {
				...validCsvFiles.behaviors,
				financialIndependence: [
					"instanceId,label,enabled,minimumNetWorth,annualExpenseTarget,annualExpenseGrowthRate,withdrawalRate,evaluationYears,requiredConfidence,sources,continuingPostingIds,principalPolicy",
					"fi,FI,true,0,40000,0.02,0.04,10,0.9,{not-json},[],preserve-real-principal",
				].join("\n"),
			},
		});
		expect(invalidJson.data).toBeNull();
		expect(invalidJson.issues[0]?.path?.[0]).toBe(
			"behavior/financial-independence.csv",
		);

		const duplicate = parseCsvFinancialModel({
			...validCsvFiles,
			behaviors: {
				...validCsvFiles.behaviors,
				netWorthThreshold: [
					"instanceId,label,enabled,target",
					"target,First,true,100",
					"target,Second,true,200",
				].join("\n"),
			},
		});
		expect(
			duplicate.issues.some(
				(issue) => issue.code === "evaluation.instanceId.duplicate",
			),
		).toBe(true);
	});

	it("rejects duplicate instance IDs across behavior files", () => {
		const result = parseCsvFinancialModel({
			...validCsvFiles,
			behaviors: {
				...validCsvFiles.behaviors,
				netWorthThreshold: [
					"instanceId,label,enabled,target",
					"shared,Threshold,true,100",
				].join("\n"),
				postingFulfillment: [
					"instanceId,label,enabled,postingIds",
					"shared,Fulfillment,true,null",
				].join("\n"),
			},
		});

		expect(
			result.issues.some(
				(issue) =>
					issue.code === "evaluation.instanceId.duplicate" &&
					issue.path?.[0] === "behavior/posting-fulfillment.csv",
			),
		).toBe(true);
	});

	it("preserves ingestion order within an evaluation table", () => {
		const result = parseCsvFinancialModel({
			...validCsvFiles,
			behaviors: {
				...validCsvFiles.behaviors,
				netWorthThreshold: [
					"instanceId,label,enabled,target",
					"second,Second,true,200",
					"first,First,true,100",
				].join("\n"),
			},
		});

		expect(
			result.data?.evaluations.netWorthThreshold.map(
				(evaluation) => evaluation.instanceId,
			),
		).toEqual(["second", "first"]);
	});

	it("validates checkpoint account references and account-date uniqueness", () => {
		const result = parseCsvFinancialModel({
			...validCsvFiles,
			checkpoints: [
				"Date,AccountId,Balance",
				"2026-03-31,missing,100",
				"2026-03-31,checking,200",
				"2026-03-31,checking,300",
			].join("\n"),
		});

		expect(result.data).not.toBeNull();
		expect(result.issues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "checkpoint.account.missing" }),
				expect.objectContaining({
					code: "checkpoint.account-date.duplicate",
				}),
			]),
		);
	});

	it("parses absolute balance checkpoints", () => {
		const result = parseCsvFinancialModel({
			...validCsvFiles,
			checkpoints: "Date,AccountId,Balance\n2026-03-31,checking,14850",
		});

		expect(result.data?.checkpoints).toEqual([
			{ Date: "2026-03-31", AccountId: "checking", Balance: 14850 },
		]);
	});

	it("removes generated posting surrogates when checkpoints are present", () => {
		const amount = csvExpressionAmount("100");
		const result = parseCsvFinancialModel({
			...validCsvFiles,
			checkpoints: "Date,AccountId,Balance\n2026-03-31,checking,100",
			postings: [
				postingsHeaderOnly.trimEnd(),
				`opening_20260331_checking,Opening checking balance,,checking,${amount},once,0,0,0,2026-03-31,,,1,true`,
			].join("\n"),
		});

		expect(result.data?.postings).toEqual([]);
	});

	it("retains generated-looking postings with non-literal expressions", () => {
		const amount = csvExpressionAmount("50 + 50");
		const result = parseCsvFinancialModel({
			...validCsvFiles,
			checkpoints: "Date,AccountId,Balance\n2026-03-31,checking,100",
			postings: [
				postingsHeaderOnly.trimEnd(),
				`opening_20260331_checking,User-authored opening,,checking,${amount},once,0,0,0,2026-03-31,,,1,true`,
			].join("\n"),
		});

		expect(result.data?.postings).toHaveLength(1);
	});

	it("rejects impossible checkpoint calendar dates", () => {
		const result = parseCsvFinancialModel({
			...validCsvFiles,
			checkpoints: "Date,AccountId,Balance\n2026-02-31,checking,100",
		});

		expect(result.data).toBeNull();
		expect(result.issues).toContainEqual(
			expect.objectContaining({ code: "csv.row.invalid" }),
		);
	});

	it("reports circular posting dependency chains", () => {
		const result = parseCsvFinancialModel({
			...validCsvFiles,
			postings: [
				postingsHeaderOnly.trimEnd(),
				`salary,Salary,,checking,${csvExpressionAmount("bonus * 1")},monthly,0,0,0,2026-04-01,,,1,true`,
				`bonus,Bonus,,checking,${csvExpressionAmount("salary * 1")},monthly,0,0,0,2026-04-01,,,2,true`,
			].join("\n"),
		});

		expect(
			result.issues.some((issue) => issue.code === "posting.amount.circular"),
		).toBe(true);
	});

	it("rejects accounts with empty minBalance/maxBalance (null is no longer allowed)", () => {
		const result = parseCsvFinancialModel(nullMinMaxCsvFiles);

		expect(result.data).toBeNull();
		expect(
			result.issues.filter((i) => i.code === "csv.row.invalid").length,
		).toBe(2);
		expect(result.issues.every((i) => i.path?.[0] === "accounts.csv")).toBe(
			true,
		);
	});

	it("reports missing posting destination accounts", () => {
		const result = parseCsvFinancialModel({
			...validCsvFiles,
			postings: [
				postingsHeaderOnly.trimEnd(),
				`mystery,Unknown Target,checking,missing_account,${csvExpressionAmount("500")},monthly,0,0,0,2026-04-15,,,1,true`,
			].join("\n"),
		});

		expect(
			result.issues.some(
				(issue) => issue.code === "posting.destination.missing",
			),
		).toBe(true);
	});

	it("warns when enabled accounts are missing chart colors", () => {
		const result = parseCsvFinancialModel({
			...validCsvFiles,
			accounts: validCsvFiles.accounts.replace(
				"checking,Checking,-Infinity,Infinity,#0f172a,true",
				"checking,Checking,-Infinity,Infinity,,true",
			),
		});

		expect(result.data).not.toBeNull();
		expect(
			result.issues.some(
				(issue) =>
					issue.severity === "warning" &&
					issue.code === "account.color.missing",
			),
		).toBe(true);
	});
});
