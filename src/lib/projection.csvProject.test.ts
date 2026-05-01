import { describe, expect, it } from "vitest";
import { projectCsvScenarioPack } from "./projection";
import type { CsvScenarioWhatIfState } from "./projection";
import { createBasePack, makeAccount, makePosting, makeSettings } from "./projection/__fixtures__";

describe("CSV projection engine", () => {
  it("builds dated checkpoint rows and future event rows from real postings", () => {
    const result = projectCsvScenarioPack(createBasePack(), makeSettings());

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
    const pack = createBasePack({
      checkpoints: [],
      accounts: [
        makeAccount({ id: "checking", category: "checking" }),
        makeAccount({ id: "brokerage", category: "brokerage" }),
      ],
      postings: [
        makePosting({ id: "salary", destinations: ["checking"], amount: 1000, startDate: "2026-01-01" }),
        makePosting({ id: "capped", sourceAccountId: "checking", destinations: ["brokerage"], amount: 200, startDate: "2026-01-15", annualCap: 500, priority: 2 }),
      ],
    });

    const result = projectCsvScenarioPack(pack, makeSettings({ horizonYears: 2 }));
    const rowByDate = new Map(result.timeline.rows.map((row) => [row.date, row]));

    expect(rowByDate.get("2026-01-15")?.realizedPostingAmount).toBe(200);
    expect(rowByDate.get("2026-02-15")?.realizedPostingAmount).toBe(200);
    expect(rowByDate.get("2026-03-15")?.realizedPostingAmount).toBe(100);
    expect(rowByDate.get("2026-04-15")?.realizedPostingAmount).toBe(0);
    expect(rowByDate.get("2027-01-15")?.realizedPostingAmount).toBe(200);
  });

  it("supports same-day percent_of_base chains in priority order", () => {
    const pack = createBasePack({
      checkpoints: [],
      accounts: [
        makeAccount({ id: "checking", category: "checking" }),
        makeAccount({ id: "k401", category: "401k" }),
      ],
      postings: [
        makePosting({ id: "salary", destinations: ["checking"], amount: 1000, startDate: "2026-01-10", endDate: "2026-01-10" }),
        makePosting({ id: "employee_k401", destinations: ["k401"], amountMode: "percent_of_base", basePostingId: "salary", amount: 0.1, startDate: "2026-01-10", endDate: "2026-01-10", priority: 2 }),
        makePosting({ id: "employer_match", destinations: ["k401"], amountMode: "percent_of_base", basePostingId: "employee_k401", amount: 0.5, startDate: "2026-01-10", endDate: "2026-01-10", priority: 3 }),
      ],
    });

    const result = projectCsvScenarioPack(pack, makeSettings());

    expect(result.timeline.rows[0]?.requestedPostingAmountsById.employee_k401).toBe(100);
    expect(result.timeline.rows[0]?.requestedPostingAmountsById.employer_match).toBe(50);
    expect(result.timeline.rows[0]?.externalInflowAmount).toBe(1150);
    expect(result.timeline.rows[0]?.accountBalances.checking).toBe(1000);
    expect(result.timeline.rows[0]?.accountBalances.k401).toBe(150);
  });

  it("clamps postings by source balance only", () => {
    const pack = createBasePack({
      checkpoints: [],
      accounts: [
        makeAccount({ id: "checking", openingBalance: 250 }),
        makeAccount({ id: "loan", openingBalance: -300 }),
      ],
      postings: [
        makePosting({ id: "loan_payment", sourceAccountId: "checking", destinations: ["loan"], amount: 400, startDate: "2026-01-10", endDate: "2026-01-10" }),
      ],
    });

    const result = projectCsvScenarioPack(pack, makeSettings());

    expect(result.timeline.rows[0]?.requestedPostingAmount).toBe(400);
    expect(result.timeline.rows[0]?.realizedPostingAmount).toBe(250);
    expect(result.timeline.rows[0]?.clampedPostingShortfallAmount).toBe(150);
    expect(result.timeline.rows[0]?.accountBalances.checking).toBe(0);
    expect(result.timeline.rows[0]?.accountBalances.loan).toBe(-50);
    expect(result.timeline.rows[0]?.netWorth).toBe(-50);
  });

  it("applies daily compounding to negative balances between dated events", () => {
    const pack = createBasePack({
      checkpoints: [],
      accounts: [
        makeAccount({ id: "loan", openingBalance: -1200, annualRate: 0.12 }),
      ],
      postings: [
        makePosting({ id: "marker", destinations: ["loan"], amount: 0, startDate: "2026-02-01", endDate: "2026-02-01" }),
      ],
    });

    const result = projectCsvScenarioPack(pack, makeSettings());

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

    const result = projectCsvScenarioPack(pack, makeSettings(), whatIfState);

    expect(pack.postings[2]?.amount).toBe(900);
    expect(result.timeline.rows[3]?.requestedPostingAmount).toBe(1800);
    expect(result.timeline.rows[3]?.realizedPostingAmount).toBe(1600);
    expect(result.postingSummaries.find((summary) => summary.postingId === "invest")?.requestedAmount).toBe(1800);
  });

  it("prevents destination accounts from exceeding maxBalance (overpayment guard)", () => {
    const pack = createBasePack({
      checkpoints: [],
      accounts: [
        makeAccount({ id: "checking", openingBalance: 400 }),
        makeAccount({ id: "loan", openingBalance: -300, maxBalance: 0 }),
      ],
      postings: [
        makePosting({ id: "paydown", sourceAccountId: "checking", destinations: ["loan"], amount: 400, startDate: "2026-01-10", endDate: "2026-01-10" }),
      ],
    });

    const result = projectCsvScenarioPack(pack, makeSettings());

    expect(result.timeline.rows[0]?.requestedPostingAmount).toBe(400);
    expect(result.timeline.rows[0]?.realizedPostingAmount).toBe(300);
    expect(result.timeline.rows[0]?.clampedPostingShortfallAmount).toBe(100);
    expect(result.timeline.rows[0]?.accountBalances.loan).toBe(0);
    expect(result.timeline.rows[0]?.accountBalances.checking).toBe(100);
    expect(result.timeline.rows[0]?.netWorth).toBe(100);
  });

  it("prevents source accounts from falling below minBalance", () => {
    const pack = createBasePack({
      checkpoints: [],
      accounts: [
        makeAccount({ id: "checking", openingBalance: 300, minBalance: 100 }),
        makeAccount({ id: "brokerage" }),
      ],
      postings: [
        makePosting({ id: "transfer", sourceAccountId: "checking", destinations: ["brokerage"], amount: 400, startDate: "2026-01-10", endDate: "2026-01-10" }),
      ],
    });

    const result = projectCsvScenarioPack(pack, makeSettings());

    expect(result.timeline.rows[0]?.realizedPostingAmount).toBe(200);
    expect(result.timeline.rows[0]?.clampedPostingShortfallAmount).toBe(200);
    expect(result.timeline.rows[0]?.accountBalances.checking).toBe(100);
  });
});
