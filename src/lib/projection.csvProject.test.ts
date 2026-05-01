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
    version: 6,
    sourcePath: "/scenario",
    accounts: [
      { id: "checking", label: "Checking", category: "checking", openingBalance: 0, annualRate: 0, color: null, enabled: true },
      { id: "brokerage", label: "Brokerage", category: "brokerage", openingBalance: 0, annualRate: 0, color: null, enabled: true },
      { id: "loan", label: "Loan", category: "loan", openingBalance: -500, annualRate: 0, color: null, enabled: true },
    ],
    checkpoints: [
      { Date: "2026-01-31", AccountId: "checking", Balance: 800 },
      { Date: "2026-01-31", AccountId: "brokerage", Balance: 1200 },
      { Date: "2026-01-31", AccountId: "loan", Balance: -400 },
    ],
    postings: [
      { id: "salary", label: "Salary", sourceAccountId: null, destinationAccountId: "checking", amountMode: "fixed", basePostingId: null, amount: 1000, annualGrowthRate: 0, startDate: "2026-02-05", endDate: "2026-02-05", annualCap: null, priority: 1, enabled: true },
      { id: "spend", label: "Spend", sourceAccountId: "checking", destinationAccountId: null, amountMode: "fixed", basePostingId: null, amount: 200, annualGrowthRate: 0, startDate: "2026-02-06", endDate: "2026-02-06", annualCap: null, priority: 1, enabled: true },
      { id: "invest", label: "Invest", sourceAccountId: "checking", destinationAccountId: "brokerage", amountMode: "fixed", basePostingId: null, amount: 900, annualGrowthRate: 0, startDate: "2026-02-10", endDate: "2026-02-10", annualCap: null, priority: 1, enabled: true },
      { id: "paydown", label: "Paydown", sourceAccountId: "checking", destinationAccountId: "loan", amountMode: "percent_of_base", basePostingId: "salary", amount: 0.25, annualGrowthRate: 0, startDate: "2026-02-20", endDate: "2026-02-20", annualCap: null, priority: 2, enabled: true },
    ],
  };
}

describe("CSV projection engine", () => {
  it("builds dated checkpoint rows and future event rows from real postings", () => {
    const result = projectCsvScenarioPack(createBasePack(), createProjectionSettings());

    expect(result.timeline.rows.map((row) => row.date)).toEqual([
      "2026-01-31",
      "2026-02-05",
      "2026-02-06",
      "2026-02-10",
      "2026-02-20",
    ]);
    expect(result.timeline.rows[0]?.isHistorical).toBe(true);
    expect(result.timeline.rows[0]?.netWorth).toBe(1600);
    expect(result.timeline.rows[1]?.externalInflowAmount).toBe(1000);
    expect(result.timeline.rows[1]?.accountBalances.checking).toBe(1800);
    expect(result.timeline.rows[2]?.externalOutflowAmount).toBe(200);
    expect(result.timeline.rows[2]?.accountBalances.checking).toBe(1600);
    expect(result.timeline.rows[3]?.internalTransferAmount).toBe(900);
    expect(result.timeline.rows[3]?.accountBalances.brokerage).toBe(2100);
    expect(result.timeline.rows[4]?.requestedPostingAmount).toBe(250);
    expect(result.timeline.rows[4]?.realizedPostingAmount).toBe(250);
    expect(result.timeline.rows[4]?.accountBalances.loan).toBe(-150);
    expect(result.summary.currentNetWorth).toBe(1600);
    expect(result.summary.finalNetWorth).toBe(2400);
    expect(result.milestones.projectionStartDate).toBe("2026-01-31");
  });

  it("applies annual caps per calendar year on dated postings", () => {
    const pack = createBasePack();
    pack.checkpoints = [];
    pack.accounts = [
      { id: "checking", label: "Checking", category: "checking", openingBalance: 0, annualRate: 0, color: null, enabled: true },
      { id: "brokerage", label: "Brokerage", category: "brokerage", openingBalance: 0, annualRate: 0, color: null, enabled: true },
    ];
    pack.postings = [
      { id: "salary", label: "Salary", sourceAccountId: null, destinationAccountId: "checking", amountMode: "fixed", basePostingId: null, amount: 1000, annualGrowthRate: 0, startDate: "2026-01-01", endDate: null, annualCap: null, priority: 1, enabled: true },
      { id: "capped", label: "Capped", sourceAccountId: "checking", destinationAccountId: "brokerage", amountMode: "fixed", basePostingId: null, amount: 200, annualGrowthRate: 0, startDate: "2026-01-15", endDate: null, annualCap: 500, priority: 2, enabled: true },
    ];

    const result = projectCsvScenarioPack(pack, createProjectionSettings({ horizonYears: 2 }));
    const rowByDate = new Map(result.timeline.rows.map((row) => [row.date, row]));

    expect(rowByDate.get("2026-01-15")?.realizedPostingAmount).toBe(200);
    expect(rowByDate.get("2026-02-15")?.realizedPostingAmount).toBe(200);
    expect(rowByDate.get("2026-03-15")?.realizedPostingAmount).toBe(100);
    expect(rowByDate.get("2026-04-15")?.realizedPostingAmount).toBe(0);
    expect(rowByDate.get("2027-01-15")?.realizedPostingAmount).toBe(200);
  });

  it("supports same-day percent_of_base chains in priority order", () => {
    const pack = createBasePack();
    pack.checkpoints = [];
    pack.accounts = [
      { id: "checking", label: "Checking", category: "checking", openingBalance: 0, annualRate: 0, color: null, enabled: true },
      { id: "k401", label: "401(k)", category: "401k", openingBalance: 0, annualRate: 0, color: null, enabled: true },
    ];
    pack.postings = [
      { id: "salary", label: "Salary", sourceAccountId: null, destinationAccountId: "checking", amountMode: "fixed", basePostingId: null, amount: 1000, annualGrowthRate: 0, startDate: "2026-01-10", endDate: "2026-01-10", annualCap: null, priority: 1, enabled: true },
      { id: "employee_k401", label: "Employee 401(k)", sourceAccountId: null, destinationAccountId: "k401", amountMode: "percent_of_base", basePostingId: "salary", amount: 0.1, annualGrowthRate: 0, startDate: "2026-01-10", endDate: "2026-01-10", annualCap: null, priority: 2, enabled: true },
      { id: "employer_match", label: "Employer Match", sourceAccountId: null, destinationAccountId: "k401", amountMode: "percent_of_base", basePostingId: "employee_k401", amount: 0.5, annualGrowthRate: 0, startDate: "2026-01-10", endDate: "2026-01-10", annualCap: null, priority: 3, enabled: true },
    ];

    const result = projectCsvScenarioPack(pack, createProjectionSettings());

    expect(result.timeline.rows[0]?.requestedPostingAmountsById.employee_k401).toBe(100);
    expect(result.timeline.rows[0]?.requestedPostingAmountsById.employer_match).toBe(50);
    expect(result.timeline.rows[0]?.externalInflowAmount).toBe(1150);
    expect(result.timeline.rows[0]?.accountBalances.checking).toBe(1000);
    expect(result.timeline.rows[0]?.accountBalances.k401).toBe(150);
  });

  it("clamps postings by source balance only", () => {
    const pack = createBasePack();
    pack.checkpoints = [];
    pack.accounts = [
      { id: "checking", label: "Checking", category: "checking", openingBalance: 250, annualRate: 0, color: null, enabled: true },
      { id: "loan", label: "Loan", category: "loan", openingBalance: -300, annualRate: 0, color: null, enabled: true },
    ];
    pack.postings = [
      { id: "loan_payment", label: "Loan Payment", sourceAccountId: "checking", destinationAccountId: "loan", amountMode: "fixed", basePostingId: null, amount: 400, annualGrowthRate: 0, startDate: "2026-01-10", endDate: "2026-01-10", annualCap: null, priority: 1, enabled: true },
    ];

    const result = projectCsvScenarioPack(pack, createProjectionSettings());

    expect(result.timeline.rows[0]?.requestedPostingAmount).toBe(400);
    expect(result.timeline.rows[0]?.realizedPostingAmount).toBe(250);
    expect(result.timeline.rows[0]?.clampedPostingShortfallAmount).toBe(150);
    expect(result.timeline.rows[0]?.accountBalances.checking).toBe(0);
    expect(result.timeline.rows[0]?.accountBalances.loan).toBe(-50);
    expect(result.timeline.rows[0]?.netWorth).toBe(-50);
  });

  it("applies daily compounding to negative balances between dated events", () => {
    const pack = createBasePack();
    pack.checkpoints = [];
    pack.accounts = [
      { id: "loan", label: "Loan", category: "loan", openingBalance: -1200, annualRate: 0.12, color: null, enabled: true },
    ];
    pack.postings = [
      { id: "marker", label: "Marker", sourceAccountId: null, destinationAccountId: "loan", amountMode: "fixed", basePostingId: null, amount: 0, annualGrowthRate: 0, startDate: "2026-02-01", endDate: "2026-02-01", annualCap: null, priority: 1, enabled: true },
    ];

    const result = projectCsvScenarioPack(pack, createProjectionSettings());

    expect(result.timeline.rows[0]?.accountBalances.loan).toBe(-1212);
    expect(result.timeline.rows[0]?.growthNetWorthImpact).toBe(-12);
    expect(result.summary.finalNetWorth).toBe(-1212);
  });

  it("applies temporary multiplier overrides without mutating the pack", () => {
    const pack = createBasePack();
    const whatIfState: CsvScenarioWhatIfState = {
      postingOverrides: {
        invest: {
          postingId: "invest",
          mode: "multiplier",
          value: 2,
        },
      },
    };

    const result = projectCsvScenarioPack(pack, createProjectionSettings(), whatIfState);

    expect(pack.postings[2]?.amount).toBe(900);
    expect(result.timeline.rows[3]?.requestedPostingAmount).toBe(1800);
    expect(result.timeline.rows[3]?.realizedPostingAmount).toBe(1600);
    expect(result.postingSummaries.find((summary) => summary.postingId === "invest")?.requestedAmount).toBe(1800);
  });
});
