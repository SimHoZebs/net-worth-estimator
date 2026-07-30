import { describe, expect, it } from "vitest";
import {
	CSV_MODEL_PUBLIC_PATH,
	parseCsvFinancialModel,
	serializeCsvFinancialModel,
} from "../";
import {
	nullMinMaxCsvFiles,
	postingsHeaderOnly,
	validCsvFiles,
} from "../__fixtures__";

describe("CSV financial model", () => {
	it("parses a valid CSV financial model", () => {
		const result = parseCsvFinancialModel(validCsvFiles, {
			basePath: CSV_MODEL_PUBLIC_PATH,
		});

		expect(result.issues).toEqual([]);
		expect(result.data?.sourcePath).toBe(CSV_MODEL_PUBLIC_PATH);
		expect(result.data?.postings[0]?.frequency).toBe("once");
		expect(result.data?.postings[5]?.arithmetic).toBe("salary * 0.22");
		expect(result.data?.postings[7]?.annualCap).toBe(23000);
		expect(result.data).not.toHaveProperty("checkpoints");
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

	it("round-trips evaluation configuration through CSV", () => {
		const parsed = parseCsvFinancialModel(validCsvFiles);
		expect(parsed.data).not.toBeNull();

		const serialized = serializeCsvFinancialModel(parsed.data!);
		const reparsed = parseCsvFinancialModel(serialized);

		expect(reparsed.issues).toEqual([]);
		expect(reparsed.data?.evaluations).toEqual(parsed.data?.evaluations);
	});

	it("defaults legacy FI CSVs and serializes an explicit expense basis", () => {
		const legacy = parseCsvFinancialModel({
			...validCsvFiles,
			behaviors: {
				...validCsvFiles.behaviors,
				financialIndependence: [
					"instanceId,label,enabled,minimumNetWorth,annualExpenseTarget,annualExpenseGrowthRate,withdrawalRate,evaluationYears,requiredConfidence,sources,continuingPostingIds,principalPolicy",
					'fi,FI,true,0,70000,0.025,0.04,10,0.9,"[]","[]",preserve-real-principal',
				].join("\n"),
			},
		});
		if (!legacy.data) throw new Error("Legacy FI CSV did not parse.");
		expect(
			legacy.data.evaluations.financialIndependence[0]?.config
				.annualExpenseTargetBasis,
		).toBe("projection-start-purchasing-power");
		legacy.data.evaluations
			.financialIndependence[0]!.config.annualExpenseTargetBasis =
			"projection-start-purchasing-power";

		const serialized = serializeCsvFinancialModel(legacy.data);
		const reparsed = parseCsvFinancialModel(serialized);

		expect(serialized.behaviors.financialIndependence).toContain(
			"annualExpenseTargetBasis",
		);
		expect(
			reparsed.data?.evaluations.financialIndependence[0]?.config
				.annualExpenseTargetBasis,
		).toBe("projection-start-purchasing-power");
	});

	it("round-trips local table order without a global row order", () => {
		const parsed = parseCsvFinancialModel(validCsvFiles);
		expect(parsed.data).not.toBeNull();
		const document = {
			...parsed.data!,
			evaluations: {
				...parsed.data!.evaluations,
				netWorthThreshold: [
					{
						instanceId: "second",
						label: "Second",
						enabled: true,
						config: { target: 2 },
					},
					{
						instanceId: "first",
						label: "First",
						enabled: true,
						config: { target: 1 },
					},
				],
			},
		};

		const reparsed = parseCsvFinancialModel(
			serializeCsvFinancialModel(document),
		);

		expect(
			reparsed.data?.evaluations.netWorthThreshold.map(
				({ instanceId }) => instanceId,
			),
		).toEqual(["second", "first"]);
	});

	it("serializes an empty evaluation collection as a valid header-only file", () => {
		const parsed = parseCsvFinancialModel(validCsvFiles);
		expect(parsed.data).not.toBeNull();

		const serialized = serializeCsvFinancialModel({
			...parsed.data!,
			evaluations: {
				financialIndependence: [],
				netWorthThreshold: [],
				postingFulfillment: [],
			},
		});
		const reparsed = parseCsvFinancialModel(serialized);

		expect(serialized.behaviors.financialIndependence).toBe(
			"instanceId,label,enabled,minimumNetWorth,annualExpenseTarget,annualExpenseGrowthRate,withdrawalRate,evaluationYears,requiredConfidence,sources,continuingPostingIds,principalPolicy,annualExpenseTargetBasis",
		);
		expect(serialized.behaviors.netWorthThreshold).toBe(
			"instanceId,label,enabled,target",
		);
		expect(reparsed.data?.evaluations).toEqual({
			financialIndependence: [],
			netWorthThreshold: [],
			postingFulfillment: [],
		});
		expect(reparsed.issues).toEqual([]);
	});

	it("escapes account and posting text when serializing", () => {
		const parsed = parseCsvFinancialModel(validCsvFiles);
		expect(parsed.data).not.toBeNull();
		const document = {
			...parsed.data!,
			accounts: parsed.data!.accounts.map((account, index) =>
				index === 0 ? { ...account, label: 'Checking, "Primary"' } : account,
			),
			postings: parsed.data!.postings.map((posting, index) =>
				index === 0 ? { ...posting, label: 'Salary, "Gross"' } : posting,
			),
		};

		const reparsed = parseCsvFinancialModel(
			serializeCsvFinancialModel(document),
		);

		expect(reparsed.data?.accounts[0]?.label).toBe('Checking, "Primary"');
		expect(reparsed.data?.postings[0]?.label).toBe('Salary, "Gross"');
		expect(reparsed.issues).toEqual([]);
	});

	it("reports circular posting dependency chains", () => {
		const result = parseCsvFinancialModel({
			...validCsvFiles,
			postings: [
				postingsHeaderOnly.trimEnd(),
				"salary,Salary,,checking,bonus * 1,monthly,0,0,0,2026-04-01,,,1,true",
				"bonus,Bonus,,checking,salary * 1,monthly,0,0,0,2026-04-01,,,2,true",
			].join("\n"),
		});

		expect(
			result.issues.some(
				(issue) => issue.code === "posting.arithmetic.circular",
			),
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
				"mystery,Unknown Target,checking,missing_account,500,monthly,0,0,0,2026-04-15,,,1,true",
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
