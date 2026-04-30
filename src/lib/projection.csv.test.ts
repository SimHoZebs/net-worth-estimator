import { describe, expect, it } from "vitest";
import { CSV_SCENARIO_PUBLIC_PATH, parseCsvScenarioPack } from "./projection";
import type { CsvScenarioFileContents } from "./projection";

const validCsvFiles: CsvScenarioFileContents = {
  scenario: [
    "name,startDate,horizonMonths,targetNetWorth",
    "Baseline,2026-04,240,1000000",
  ].join("\n"),
  accounts: [
    "id,label,balanceType,category,openingBalance,annualRate,color,enabled",
    "checking,Checking,asset,checking,15000,0.01,#0f172a,true",
    "k401,401(k),asset,401k,120000,0.07,#2563eb,true",
    "brokerage,Brokerage,asset,brokerage,80000,0.07,#16a34a,true",
  ].join("\n"),
  checkpoints: [
    "Date,AccountId,Balance",
    "2026-03-31,checking,14850",
    "2026-03-31,k401,119400",
    "2026-03-31,brokerage,79500",
  ].join("\n"),
  budgetItems: [
    "id,label,direction,parentBudgetItemId,amountMode,amount,annualGrowthRate,startMonth,endMonth,frequencyMonths,category,enabled",
    "salary,Salary,in,,fixed,15000,0.03,2026-04,,1,earned_income,true",
    "taxes,Taxes,out,salary,percent_of_parent,0.22,0,2026-04,,1,tax,true",
    "housing,Housing,out,,fixed,3200,0.02,2026-04,,1,housing,true",
  ].join("\n"),
  contributionPlans: [
    "id,label,targetAccountId,calculationMode,baseBudgetItemId,amount,startMonth,endMonth,frequencyMonths,annualCap,priority,enabled",
    "k401_employee,401(k) Employee,k401,percent_of_budget_item,salary,0.1,2026-04,,1,23000,1,true",
    "brokerage_auto,Brokerage Auto,brokerage,percent_of_capacity,,0.5,2026-04,,1,,2,true",
  ].join("\n"),
  transfers: [
    "id,label,sourceAccountId,destinationAccountId,amountMode,amount,startMonth,endMonth,frequencyMonths,enabled",
  ].join("\n"),
};

describe("CSV scenario pack", () => {
  it("parses a valid CSV pack", () => {
    const result = parseCsvScenarioPack(validCsvFiles, { basePath: CSV_SCENARIO_PUBLIC_PATH });

    expect(result.issues).toEqual([]);
    expect(result.data?.version).toBe(3);
    expect(result.data?.sourcePath).toBe(CSV_SCENARIO_PUBLIC_PATH);
    expect(result.data?.budgetItems[1].parentBudgetItemId).toBe("salary");
    expect(result.data?.contributionPlans[1].annualCap).toBeNull();
  });

  it("reports circular budget parent chains", () => {
    const result = parseCsvScenarioPack({
      ...validCsvFiles,
      budgetItems: [
        "id,label,direction,parentBudgetItemId,amountMode,amount,annualGrowthRate,startMonth,endMonth,frequencyMonths,category,enabled",
        "salary,Salary,in,bonus,percent_of_parent,1,0,2026-04,,1,earned_income,true",
        "bonus,Bonus,in,salary,percent_of_parent,1,0,2026-04,,1,earned_income,true",
      ].join("\n"),
    });

    expect(result.issues.some((issue) => issue.code === "budget.parent.circular")).toBe(true);
  });

  it("reports missing contribution target accounts", () => {
    const result = parseCsvScenarioPack({
      ...validCsvFiles,
      contributionPlans: [
        "id,label,targetAccountId,calculationMode,baseBudgetItemId,amount,startMonth,endMonth,frequencyMonths,annualCap,priority,enabled",
        "mystery,Unknown Target,missing_account,fixed,,500,2026-04,,1,,1,true",
      ].join("\n"),
    });

    expect(result.issues.some((issue) => issue.code === "contribution.target.missing")).toBe(true);
  });
});
