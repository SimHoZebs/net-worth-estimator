import { describe, expect, it } from "vitest";
import { CSV_SCENARIO_PUBLIC_PATH, parseCsvScenarioPack } from "../";
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
		expect(result.data?.version).toBe(8);
		expect(result.data?.sourcePath).toBe(CSV_SCENARIO_PUBLIC_PATH);
		expect(result.data?.postings[1]?.arithmetic).toBe("salary * 0.22");
		expect(result.data?.postings[3]?.annualCap).toBe(23000);
		expect(result.data?.accounts[3]?.label).toBe("Student Loan");
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
});
