import { describe, expect, it } from "vitest";
import { CSV_SCENARIO_PUBLIC_PATH, parseCsvScenarioPack } from "../";
import { postingsHeaderOnly, validCsvFiles } from "../__fixtures__";

describe("CSV scenario pack", () => {
  it("parses a valid CSV pack", () => {
    const result = parseCsvScenarioPack(validCsvFiles, { basePath: CSV_SCENARIO_PUBLIC_PATH });

    expect(result.issues).toEqual([]);
    expect(result.data?.version).toBe(7);
    expect(result.data?.sourcePath).toBe(CSV_SCENARIO_PUBLIC_PATH);
    expect(result.data?.postings[1]?.basePostingId).toBe("salary");
    expect(result.data?.postings[3]?.annualCap).toBe(23000);
    expect(result.data?.accounts[3]?.label).toBe("Student Loan");
  });

  it("reports circular posting base chains", () => {
    const result = parseCsvScenarioPack({
      ...validCsvFiles,
      postings: [
        postingsHeaderOnly.trimEnd(),
        "salary,Salary,,checking,percent_of_base,bonus,false,1,0,2026-04-01,,,1,true",
        "bonus,Bonus,,checking,percent_of_base,salary,false,1,0,2026-04-01,,,2,true",
      ].join("\n"),
    });

    expect(result.issues.some((issue) => issue.code === "posting.base.circular")).toBe(true);
  });

  it("reports missing posting destination accounts", () => {
    const result = parseCsvScenarioPack({
      ...validCsvFiles,
      postings: [
        postingsHeaderOnly.trimEnd(),
        "mystery,Unknown Target,checking,missing_account,fixed,,false,500,0,2026-04-15,,,1,true",
      ].join("\n"),
    });

    expect(result.issues.some((issue) => issue.code === "posting.destination.missing")).toBe(true);
  });
});
