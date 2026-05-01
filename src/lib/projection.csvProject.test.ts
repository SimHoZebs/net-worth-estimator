import { describe, expect, it } from "vitest";
import { projectCsvScenarioPack } from "./projection";
import type { CsvScenarioPack, CsvScenarioWhatIfState } from "./projection";

function createBasePack(): CsvScenarioPack {
  return {
    version: 3,
    sourcePath: "/scenario",
    scenario: {
      name: "Test pack",
      startDate: "2026-03",
      horizonMonths: 2,
      targetNetWorth: 5000,
    },
    accounts: [
      { id: "brokerage", label: "Brokerage", balanceType: "asset", category: "brokerage", openingBalance: 0, annualRate: 0, color: null, enabled: true },
      { id: "loan", label: "Loan", balanceType: "liability", category: "loan", openingBalance: 500, annualRate: 0, color: null, enabled: true },
      { id: "checking", label: "Checking", balanceType: "asset", category: "checking", openingBalance: 0, annualRate: 0, color: null, enabled: true },
    ],
    checkpoints: [
      { Date: "2026-01-31", AccountId: "brokerage", Balance: 1000 },
      { Date: "2026-02-28", AccountId: "brokerage", Balance: 1200 },
      { Date: "2026-02-28", AccountId: "loan", Balance: 400 },
    ],
    budgetItems: [
      { id: "income", label: "Income", direction: "in", parentBudgetItemId: null, amountMode: "fixed", amount: 1000, annualGrowthRate: 0, startMonth: "2026-03", endMonth: null, frequencyMonths: 1, category: "income", enabled: true },
      { id: "spend", label: "Spend", direction: "out", parentBudgetItemId: null, amountMode: "fixed", amount: 200, annualGrowthRate: 0, startMonth: "2026-03", endMonth: null, frequencyMonths: 1, category: "living", enabled: true },
    ],
    contributionPlans: [
      { id: "invest", label: "Invest", targetAccountId: "brokerage", calculationMode: "fixed", baseBudgetItemId: null, amount: 500, startMonth: "2026-03", endMonth: null, frequencyMonths: 1, annualCap: null, priority: 1, enabled: true },
      { id: "paydown", label: "Paydown", targetAccountId: "loan", calculationMode: "percent_of_capacity", baseBudgetItemId: null, amount: 0.5, startMonth: "2026-03", endMonth: null, frequencyMonths: 1, annualCap: null, priority: 2, enabled: true },
    ],
    transfers: [],
  };
}

describe("CSV projection engine", () => {
  it("builds historical rows from checkpoints and clamps future contributions by capacity", () => {
    const result = projectCsvScenarioPack(createBasePack());

    expect(result.timeline.monthlyRows.map((row) => row.monthLabel)).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    expect(result.timeline.monthlyRows[1]?.isHistorical).toBe(true);
    expect(result.timeline.monthlyRows[1]?.netWorth).toBe(800);
    expect(result.timeline.monthlyRows[2]?.investableCapacity).toBe(800);
    expect(result.timeline.monthlyRows[2]?.requestedContributionAmount).toBe(900);
    expect(result.timeline.monthlyRows[2]?.realizedContributionAmount).toBe(800);
    expect(result.timeline.monthlyRows[2]?.accountBalances.brokerage).toBe(1700);
    expect(result.timeline.monthlyRows[2]?.accountBalances.loan).toBe(100);
    expect(result.summary.currentNetWorth).toBe(800);
    expect(result.summary.finalNetWorth).toBe(2200);
  });

  it("applies annual caps per calendar year", () => {
    const pack = createBasePack();
    pack.scenario.startDate = "2026-01";
    pack.scenario.horizonMonths = 13;
    pack.checkpoints = [];
    pack.accounts = [
      { id: "brokerage", label: "Brokerage", balanceType: "asset", category: "brokerage", openingBalance: 0, annualRate: 0, color: null, enabled: true },
    ];
    pack.budgetItems = [
      { id: "income", label: "Income", direction: "in", parentBudgetItemId: null, amountMode: "fixed", amount: 1000, annualGrowthRate: 0, startMonth: "2026-01", endMonth: null, frequencyMonths: 1, category: "income", enabled: true },
    ];
    pack.contributionPlans = [
      { id: "capped", label: "Capped", targetAccountId: "brokerage", calculationMode: "fixed", baseBudgetItemId: null, amount: 200, startMonth: "2026-01", endMonth: null, frequencyMonths: 1, annualCap: 500, priority: 1, enabled: true },
    ];

    const result = projectCsvScenarioPack(pack);

    expect(result.timeline.monthlyRows[0]?.realizedContributionAmount).toBe(200);
    expect(result.timeline.monthlyRows[1]?.realizedContributionAmount).toBe(200);
    expect(result.timeline.monthlyRows[2]?.realizedContributionAmount).toBe(100);
    expect(result.timeline.monthlyRows[3]?.realizedContributionAmount).toBe(0);
    expect(result.timeline.monthlyRows[12]?.monthLabel).toBe("2027-01");
    expect(result.timeline.monthlyRows[12]?.realizedContributionAmount).toBe(200);
  });

  it("clamps transfers when paying down liabilities", () => {
    const pack = createBasePack();
    pack.scenario.startDate = "2026-01";
    pack.scenario.horizonMonths = 1;
    pack.checkpoints = [];
    pack.accounts = [
      { id: "checking", label: "Checking", balanceType: "asset", category: "checking", openingBalance: 500, annualRate: 0, color: null, enabled: true },
      { id: "loan", label: "Loan", balanceType: "liability", category: "loan", openingBalance: 300, annualRate: 0, color: null, enabled: true },
    ];
    pack.budgetItems = [];
    pack.contributionPlans = [];
    pack.transfers = [
      { id: "loan_payment", label: "Loan Payment", sourceAccountId: "checking", destinationAccountId: "loan", amountMode: "fixed", amount: 400, startMonth: "2026-01", endMonth: null, frequencyMonths: 1, enabled: true },
    ];

    const result = projectCsvScenarioPack(pack);

    expect(result.timeline.monthlyRows[0]?.transferAmount).toBe(300);
    expect(result.timeline.monthlyRows[0]?.accountBalances.checking).toBe(200);
    expect(result.timeline.monthlyRows[0]?.accountBalances.loan).toBe(0);
    expect(result.timeline.monthlyRows[0]?.netWorth).toBe(200);
  });

  it("applies temporary multiplier overrides without mutating the pack", () => {
    const pack = createBasePack();
    const whatIfState: CsvScenarioWhatIfState = {
      contributionPlanOverrides: {
        invest: {
          contributionPlanId: "invest",
          mode: "multiplier",
          value: 2,
        },
      },
    };

    const result = projectCsvScenarioPack(pack, whatIfState);

    expect(pack.contributionPlans[0]?.amount).toBe(500);
    expect(result.timeline.monthlyRows[2]?.requestedContributionAmount).toBe(1400);
    expect(result.timeline.monthlyRows[2]?.realizedContributionAmount).toBe(800);
    expect(result.contributionSummaries.find((summary) => summary.contributionPlanId === "invest")?.requestedAmount).toBe(2000);
  });
});
