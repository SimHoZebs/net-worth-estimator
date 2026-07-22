import { describe, expect, it } from "vitest";
import {
	CSV_SCENARIO_PUBLIC_PATH,
	parseCsvScenarioPack,
	serializeCsvScenarioPack,
} from "../";
import {
	nullMinMaxCsvFiles,
	postingsHeaderOnly,
	validCsvFiles,
} from "../__fixtures__";

describe("CSV scenario pack", () => {
	it("parses a valid CSV pack", () => {
		const result = parseCsvScenarioPack(validCsvFiles, {
			basePath: CSV_SCENARIO_PUBLIC_PATH,
		});

		expect(result.issues).toEqual([]);
		expect(result.data?.version).toBe(9);
		expect(result.data?.sourcePath).toBe(CSV_SCENARIO_PUBLIC_PATH);
		expect(result.data?.postings[1]?.arithmetic).toBe("salary * 0.22");
		expect(result.data?.postings[3]?.annualCap).toBe(23000);
		expect(result.data?.accounts[3]?.label).toBe("Student Loan");
		expect(result.data?.evaluations[0]?.config).toEqual({ target: 1_000_000 });
	});

	it("rejects invalid evaluation JSON and duplicate instance IDs", () => {
		const invalidJson = parseCsvScenarioPack({
			...validCsvFiles,
			behaviors: {
				...validCsvFiles.behaviors,
				financialIndependence: [
					"order,instanceId,label,enabled,config",
					'1,fi,FI,true,"{not-json}"',
				].join("\n"),
			},
		});
		expect(invalidJson.data).toBeNull();
		expect(invalidJson.issues[0]?.path?.[0]).toBe(
			"behavior/financial-independence.csv",
		);

		const duplicate = parseCsvScenarioPack({
			...validCsvFiles,
			behaviors: {
				...validCsvFiles.behaviors,
				netWorthThreshold: [
					"order,instanceId,label,enabled,config",
					'1,target,First,true,"{""target"":100}"',
					'2,target,Second,true,"{""target"":200}"',
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
		const result = parseCsvScenarioPack({
			...validCsvFiles,
			behaviors: {
				...validCsvFiles.behaviors,
				financialIndependence: [
					"order,instanceId,label,enabled,config",
					'1,shared,FI,true,"{}"',
				].join("\n"),
				netWorthThreshold: [
					"order,instanceId,label,enabled,config",
					'2,shared,Threshold,true,"{""target"":100}"',
				].join("\n"),
			},
		});

		expect(
			result.issues.some(
				(issue) =>
					issue.code === "evaluation.instanceId.duplicate" &&
					issue.path?.[0] === "behavior/net-worth-threshold.csv",
			),
		).toBe(true);
	});

	it("rejects duplicate global order values across behavior files", () => {
		const result = parseCsvScenarioPack({
			...validCsvFiles,
			behaviors: {
				...validCsvFiles.behaviors,
				financialIndependence: [
					"order,instanceId,label,enabled,config",
					'1,fi,FI,true,"{}"',
				].join("\n"),
				netWorthThreshold: [
					"order,instanceId,label,enabled,config",
					'1,target,Threshold,true,"{""target"":100}"',
				].join("\n"),
			},
		});

		expect(
			result.issues.some(
				(issue) =>
					issue.code === "behavior.order.duplicate" &&
					issue.path?.[0] === "behavior/net-worth-threshold.csv",
			),
		).toBe(true);
	});

	it("round-trips evaluation configuration through CSV", () => {
		const parsed = parseCsvScenarioPack(validCsvFiles);
		expect(parsed.data).not.toBeNull();

		const serialized = serializeCsvScenarioPack(parsed.data!);
		const reparsed = parseCsvScenarioPack(serialized);

		expect(reparsed.issues).toEqual([]);
		expect(reparsed.data?.evaluations).toEqual(parsed.data?.evaluations);
	});

	it("preserves evaluation order across behavior files", () => {
		const parsed = parseCsvScenarioPack(validCsvFiles);
		expect(parsed.data).not.toBeNull();
		const mixed = {
			...parsed.data!,
			evaluations: [
				{
					definitionId: "financial-independence",
					instanceId: "fi-1",
					label: "FI 1",
					enabled: true,
					config: {},
				},
				parsed.data!.evaluations[0]!,
				{
					definitionId: "financial-independence",
					instanceId: "fi-2",
					label: "FI 2",
					enabled: true,
					config: {},
				},
			],
		};

		const reparsed = parseCsvScenarioPack(serializeCsvScenarioPack(mixed));

		expect(
			reparsed.data?.evaluations.map(({ instanceId }) => instanceId),
		).toEqual(["fi-1", "net-worth-1m", "fi-2"]);
	});

	it("serializes an empty evaluation collection as a valid header-only file", () => {
		const parsed = parseCsvScenarioPack(validCsvFiles);
		expect(parsed.data).not.toBeNull();

		const serialized = serializeCsvScenarioPack({
			...parsed.data!,
			evaluations: [],
		});
		const reparsed = parseCsvScenarioPack(serialized);

		expect(serialized.behaviors.financialIndependence).toBe(
			"order,instanceId,label,enabled,config",
		);
		expect(serialized.behaviors.netWorthThreshold).toBe(
			"order,instanceId,label,enabled,config",
		);
		expect(reparsed.data?.evaluations).toEqual([]);
		expect(reparsed.issues).toEqual([]);
	});

	it("reports circular posting dependency chains", () => {
		const result = parseCsvScenarioPack({
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
		const result = parseCsvScenarioPack(nullMinMaxCsvFiles);

		expect(result.data).toBeNull();
		expect(
			result.issues.filter((i) => i.code === "csv.row.invalid").length,
		).toBe(2);
		expect(result.issues.every((i) => i.path?.[0] === "accounts.csv")).toBe(
			true,
		);
	});

	it("reports missing posting destination accounts", () => {
		const result = parseCsvScenarioPack({
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
		const result = parseCsvScenarioPack({
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
