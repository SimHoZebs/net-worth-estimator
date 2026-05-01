import { describe, expect, it } from "vitest";
import { CSV_SCENARIO_PUBLIC_PATH, parseCsvScenarioPack } from "./projection";
import type { CsvScenarioFileContents } from "./projection";

const validCsvFiles: CsvScenarioFileContents = {
  accounts: [
    "id,label,category,openingBalance,annualRate,color,enabled",
    "checking,Checking,checking,15000,0.01,#0f172a,true",
    "k401,401(k),401k,120000,0.07,#2563eb,true",
    "brokerage,Brokerage,brokerage,80000,0.07,#16a34a,true",
    "student_loan,Student Loan,loan,-12000,0.05,#dc2626,true",
  ].join("\n"),
  checkpoints: [
    "Date,AccountId,Balance",
    "2026-03-31,checking,14850",
    "2026-03-31,k401,119400",
    "2026-03-31,brokerage,79500",
    "2026-03-31,student_loan,-12150",
  ].join("\n"),
  postings: [
    "id,label,sourceAccountId,destinationAccountId,amountMode,basePostingId,amount,annualGrowthRate,startDate,endDate,annualCap,priority,enabled",
    "salary,Salary,,checking,fixed,,15000,0.03,2026-04-01,,,1,true",
    "taxes,Taxes,checking,,percent_of_base,salary,0.22,0,2026-04-01,,,2,true",
    "housing,Housing,checking,,fixed,,3200,0.02,2026-04-05,,,3,true",
    "k401_employee,401(k) Employee,checking,k401,percent_of_base,salary,0.1,0,2026-04-15,,23000,4,true",
    "k401_match,401(k) Match,,k401,percent_of_base,k401_employee,0.5,0,2026-04-15,,,5,true",
    "brokerage_auto,Brokerage Auto,checking,brokerage,fixed,,500,0,2026-04-28,,,6,true",
  ].join("\n"),
};

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
        "id,label,sourceAccountId,destinationAccountId,amountMode,basePostingId,amount,annualGrowthRate,startDate,endDate,annualCap,priority,enabled",
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
        "id,label,sourceAccountId,destinationAccountId,amountMode,basePostingId,amount,annualGrowthRate,startDate,endDate,annualCap,priority,enabled",
        "mystery,Unknown Target,checking,missing_account,fixed,,500,0,2026-04-15,,,1,true",
      ].join("\n"),
    });

    expect(result.issues.some((issue) => issue.code === "posting.destination.missing")).toBe(true);
  });
});
