import { describe, expect, it } from "vitest";
import { projectCsvScenarioPack } from "./projection";
import type { CsvScenarioPack, CsvScenarioWhatIfState, ProjectionRuntimeSettings } from "./projection";

function createProjectionSettings(overrides: Partial<ProjectionRuntimeSettings> = {}): ProjectionRuntimeSettings {
  return {
    targetNetWorth: 5000,
    fallbackProjectionStartDate: "2026-01-01",
    horizonYears: 1,
    ...overrides,
  };
}

function createBasePack(): CsvScenarioPack {
  return {
    version: 5,
    sourcePath: "/scenario",
    accounts: [
      { id: "brokerage", label: "Brokerage", category: "brokerage", openingBalance: 0, annualRate: 0, color: null, enabled: true },
      { id: "loan", label: "Loan", category: "loan", openingBalance: -500, annualRate: 0, color: null, enabled: true },
    ],
    checkpoints: [
      { Date: "2026-01-31", AccountId: "brokerage", Balance: 1200 },
      { Date: "2026-01-31", AccountId: "loan", Balance: -400 },
    ],
    budgetItems: [
      { id: "income", label: "Income", direction: "in", parentBudgetItemId: null, amountMode: "fixed", amount: 1000, annualGrowthRate: 0, startDate: "2026-02-05", endDate: "2026-02-05", category: "income", enabled: true },
      { id: "spend", label: "Spend", direction: "out", parentBudgetItemId: null, amountMode: "fixed", amount: 200, annualGrowthRate: 0, startDate: "2026-02-06", endDate: "2026-02-06", category: "living", enabled: true },
    ],
    contributionPlans: [
      { id: "invest", label: "Invest", targetAccountId: "brokerage", calculationMode: "fixed", baseBudgetItemId: null, amount: 500, startDate: "2026-02-10", endDate: "2026-02-10", annualCap: null, priority: 1, enabled: true },
      { id: "paydown", label: "Paydown", targetAccountId: "loan", calculationMode: "percent_of_capacity", baseBudgetItemId: null, amount: 0.5, startDate: "2026-02-20", endDate: "2026-02-20", annualCap: null, priority: 2, enabled: true },
    ],
    transfers: [],
  };
}

describe("CSV projection engine", () => {
  it("builds dated checkpoint rows and future event rows", () => {
    const result = projectCsvScenarioPack(createBasePack(), createProjectionSettings());

    expect(result.timeline.rows.map((row) => row.date)).toEqual([
      "2026-01-31",
      "2026-02-05",
      "2026-02-06",
      "2026-02-10",
      "2026-02-20",
    ]);
    expect(result.timeline.rows[0]?.isHistorical).toBe(true);
    expect(result.timeline.rows[0]?.netWorth).toBe(800);
    expect(result.timeline.rows[1]?.budgetCashflowAmount).toBe(1000);
    expect(result.timeline.rows[1]?.availableContributionCapacity).toBe(1000);
    expect(result.timeline.rows[2]?.budgetCashflowAmount).toBe(-200);
    expect(result.timeline.rows[2]?.availableContributionCapacity).toBe(800);
    expect(result.timeline.rows[3]?.requestedContributionAmount).toBe(500);
    expect(result.timeline.rows[3]?.realizedContributionAmount).toBe(500);
    expect(result.timeline.rows[3]?.accountBalances.brokerage).toBe(1700);
    expect(result.timeline.rows[4]?.accountBalances.loan).toBe(-250);
    expect(result.summary.currentNetWorth).toBe(800);
    expect(result.summary.finalNetWorth).toBe(1450);
    expect(result.milestones.projectionStartDate).toBe("2026-01-31");
  });

  it("applies annual caps per calendar year on dated contribution events", () => {
    const pack = createBasePack();
    pack.checkpoints = [];
    pack.accounts = [
      { id: "brokerage", label: "Brokerage", category: "brokerage", openingBalance: 0, annualRate: 0, color: null, enabled: true },
    ];
    pack.budgetItems = [
      { id: "income", label: "Income", direction: "in", parentBudgetItemId: null, amountMode: "fixed", amount: 1000, annualGrowthRate: 0, startDate: "2026-01-01", endDate: null, category: "income", enabled: true },
    ];
    pack.contributionPlans = [
      { id: "capped", label: "Capped", targetAccountId: "brokerage", calculationMode: "fixed", baseBudgetItemId: null, amount: 200, startDate: "2026-01-15", endDate: null, annualCap: 500, priority: 1, enabled: true },
    ];

    const result = projectCsvScenarioPack(pack, createProjectionSettings({ horizonYears: 2 }));
    const rowByDate = new Map(result.timeline.rows.map((row) => [row.date, row]));

    expect(rowByDate.get("2026-01-15")?.realizedContributionAmount).toBe(200);
    expect(rowByDate.get("2026-02-15")?.realizedContributionAmount).toBe(200);
    expect(rowByDate.get("2026-03-15")?.realizedContributionAmount).toBe(100);
    expect(rowByDate.get("2026-04-15")?.realizedContributionAmount).toBe(0);
    expect(rowByDate.get("2027-01-15")?.realizedContributionAmount).toBe(200);
  });

  it("clamps transfers by source balance only", () => {
    const pack = createBasePack();
    pack.checkpoints = [];
    pack.accounts = [
      { id: "checking", label: "Checking", category: "checking", openingBalance: 500, annualRate: 0, color: null, enabled: true },
      { id: "loan", label: "Loan", category: "loan", openingBalance: -300, annualRate: 0, color: null, enabled: true },
    ];
    pack.budgetItems = [];
    pack.contributionPlans = [];
    pack.transfers = [
      { id: "loan_payment", label: "Loan Payment", sourceAccountId: "checking", destinationAccountId: "loan", amountMode: "fixed", amount: 400, startDate: "2026-01-10", endDate: "2026-01-10", enabled: true },
    ];

    const result = projectCsvScenarioPack(pack, createProjectionSettings());

    expect(result.timeline.rows[0]?.transferAmount).toBe(400);
    expect(result.timeline.rows[0]?.accountBalances.checking).toBe(100);
    expect(result.timeline.rows[0]?.accountBalances.loan).toBe(100);
    expect(result.timeline.rows[0]?.netWorth).toBe(200);
  });

  it("applies daily compounding to negative balances between dated events", () => {
    const pack = createBasePack();
    pack.checkpoints = [];
    pack.accounts = [
      { id: "loan", label: "Loan", category: "loan", openingBalance: -1200, annualRate: 0.12, color: null, enabled: true },
    ];
    pack.budgetItems = [
      { id: "marker", label: "Marker", direction: "in", parentBudgetItemId: null, amountMode: "fixed", amount: 0, annualGrowthRate: 0, startDate: "2026-02-01", endDate: "2026-02-01", category: "marker", enabled: true },
    ];
    pack.contributionPlans = [];
    pack.transfers = [];

    const result = projectCsvScenarioPack(pack, createProjectionSettings());

    expect(result.timeline.rows[0]?.accountBalances.loan).toBe(-1212);
    expect(result.timeline.rows[0]?.growthNetWorthImpact).toBe(-12);
    expect(result.summary.finalNetWorth).toBe(-1212);
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

    const result = projectCsvScenarioPack(pack, createProjectionSettings(), whatIfState);

    expect(pack.contributionPlans[0]?.amount).toBe(500);
    expect(result.timeline.rows[3]?.requestedContributionAmount).toBe(1000);
    expect(result.timeline.rows[3]?.realizedContributionAmount).toBe(800);
    expect(result.contributionSummaries.find((summary) => summary.contributionPlanId === "invest")?.requestedAmount).toBe(1000);
  });
});
