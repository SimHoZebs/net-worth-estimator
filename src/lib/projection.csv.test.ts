import { describe, expect, it } from "vitest";
import { CSV_SCENARIO_PUBLIC_PATH, parseCsvScenarioPack } from "./projection";
import { postingsHeaderOnly, validCsvFiles } from "./projection/__fixtures__";

describe("CSV scenario pack", () => {
  it("parses a valid CSV pack", () => {
    const result = parseCsvScenarioPack(validCsvFiles, { basePath: CSV_SCENARIO_PUBLIC_PATH });

    expect(result.issues).toEqual([]);
    expect(result.data?.version).toBe(6);
    expect(result.data?.sourcePath).toBe(CSV_SCENARIO_PUBLIC_PATH);
    expect(result.data?.postings[1]?.basePostingId).toBe("salary");
    expect(result.data?.postings[3]?.annualCap).toBe(23000);
    expect(result.data?.accounts[3]?.openingBalance).toBe(-12000);
  });

  it("reports circular posting base chains", () => {
    const result = parseCsvScenarioPack({
      ...validCsvFiles,
      postings: [
        postingsHeaderOnly.trimEnd(),
        "salary,Salary,,checking,percent_of_base,bonus,1,0,2026-04-01,,,1,true",
        "bonus,Bonus,,checking,percent_of_base,salary,1,0,2026-04-01,,,2,true",
      ].join("\n"),
    });

    expect(result.issues.some((issue) => issue.code === "posting.base.circular")).toBe(true);
  });

  it("reports missing posting destination accounts", () => {
    const result = parseCsvScenarioPack({
      ...validCsvFiles,
      postings: [
        postingsHeaderOnly.trimEnd(),
        "mystery,Unknown Target,checking,missing_account,fixed,,500,0,2026-04-15,,,1,true",
      ].join("\n"),
    });

    expect(result.issues.some((issue) => issue.code === "posting.destination.missing")).toBe(true);
  });
});
