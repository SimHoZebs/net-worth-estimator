import { describe, expect, it } from "vitest";
import { NO_FLOOR, NO_CEILING } from "../constants";
import { projectScenarioPack } from "../";
import { createBasePack, makeAccount, makePosting, makeSettings } from "../__fixtures__";

describe("CSV projection engine", () => {
  it("builds dated checkpoint rows and future event rows from real postings", () => {
    const result = projectScenarioPack(createBasePack(), makeSettings());

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
        makeAccount({ id: "checking" }),
        makeAccount({ id: "brokerage" }),
      ],
      postings: [
        makePosting({ id: "salary", destinations: ["checking"], arithmetic: "1000", startDate: "2026-01-01" }),
        makePosting({ id: "capped", sourceAccountId: "checking", destinations: ["brokerage"], arithmetic: "200", startDate: "2026-01-15", annualCap: 500, priority: 2 }),
      ],
    });

    const result = projectScenarioPack(pack, makeSettings({ horizonYears: 2 }));
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
        makeAccount({ id: "checking" }),
        makeAccount({ id: "k401" }),
      ],
      postings: [
        makePosting({ id: "salary", destinations: ["checking"], arithmetic: "1000", startDate: "2026-01-10", endDate: "2026-01-10" }),
        makePosting({ id: "employee_k401", destinations: ["k401"], arithmetic: "salary * 0.1", startDate: "2026-01-10", endDate: "2026-01-10", priority: 2 }),
        makePosting({ id: "employer_match", destinations: ["k401"], arithmetic: "employee_k401 * 0.5", startDate: "2026-01-10", endDate: "2026-01-10", priority: 3 }),
      ],
    });

    const result = projectScenarioPack(pack, makeSettings());

    expect(result.timeline.rows[0]?.requestedPostingAmountsById.employee_k401).toBe(100);
    expect(result.timeline.rows[0]?.requestedPostingAmountsById.employer_match).toBe(50);
    expect(result.timeline.rows[0]?.externalInflowAmount).toBe(1150);
    expect(result.timeline.rows[0]?.accountBalances.checking).toBe(1000);
    expect(result.timeline.rows[0]?.accountBalances.k401).toBe(150);
  });

  it("clamps postings by source balance only", () => {
    const pack = createBasePack({
      checkpoints: [
        { Date: "2026-01-01", AccountId: "checking", Balance: 250 },
        { Date: "2026-01-01", AccountId: "loan", Balance: -300 },
      ],
      accounts: [
        makeAccount({ id: "checking", minBalance: 0 }),
        makeAccount({ id: "loan" }),
      ],
      postings: [
        makePosting({ id: "loan_payment", sourceAccountId: "checking", destinations: ["loan"], arithmetic: "400", startDate: "2026-01-10", endDate: "2026-01-10" }),
      ],
    });

    const result = projectScenarioPack(pack, makeSettings());

    expect(result.timeline.rows[1]?.requestedPostingAmount).toBe(400);
    expect(result.timeline.rows[1]?.realizedPostingAmount).toBe(250);
    expect(result.timeline.rows[1]?.clampedPostingShortfallAmount).toBe(150);
    expect(result.timeline.rows[1]?.accountBalances.checking).toBe(0);
    expect(result.timeline.rows[1]?.accountBalances.loan).toBe(-50);
    expect(result.timeline.rows[1]?.netWorth).toBe(-50);
  });

  it("throws when source account has null minBalance (fail-fast)", () => {
    const pack = createBasePack({
      checkpoints: [
        { Date: "2026-01-01", AccountId: "checking", Balance: 300 },
        { Date: "2026-01-01", AccountId: "loan", Balance: -200 },
      ],
      accounts: [
        { id: "checking", label: "Checking", minBalance: NO_FLOOR, maxBalance: NO_CEILING, color: null, enabled: true },
        { id: "loan", label: "Loan", minBalance: null as unknown as number, maxBalance: 0, color: null, enabled: true },
      ],
      postings: [
        makePosting({ id: "interest", sourceAccountId: "loan", arithmetic: "100", startDate: "2026-01-10", endDate: "2026-01-10" }),
      ],
    });

    expect(() => projectScenarioPack(pack, makeSettings())).toThrow("has no minBalance configured");
  });

  it("throws when destination account has null maxBalance (fail-fast)", () => {
    const pack = createBasePack({
      checkpoints: [
        { Date: "2026-01-01", AccountId: "checking", Balance: 300 },
        { Date: "2026-01-01", AccountId: "loan", Balance: -200 },
      ],
      accounts: [
        { id: "checking", label: "Checking", minBalance: NO_FLOOR, maxBalance: null as unknown as number, color: null, enabled: true },
        { id: "loan", label: "Loan", minBalance: NO_FLOOR, maxBalance: 0, color: null, enabled: true },
      ],
      postings: [
        makePosting({ id: "payment", sourceAccountId: "loan", destinations: ["checking"], arithmetic: "100", startDate: "2026-01-10", endDate: "2026-01-10" }),
      ],
    });

    expect(() => projectScenarioPack(pack, makeSettings())).toThrow("has no maxBalance configured");
  });

  it("applies interest via postings with rate keyword", () => {
    const pack = createBasePack({
      checkpoints: [
        { Date: "2026-01-01", AccountId: "loan", Balance: -1200 },
      ],
      accounts: [
        makeAccount({ id: "loan", minBalance: NO_FLOOR }),
      ],
      postings: [
        makePosting({
          id: "loan_interest",
          sourceAccountId: "loan",
          arithmetic: "abs(loan) * rate",
          frequency: "monthly",
          annualRate: 0.12,
          startDate: "2026-02-01",
          endDate: "2026-02-01",
        }),
      ],
    });

    const result = projectScenarioPack(pack, makeSettings());

    expect(result.timeline.rows[1]?.accountBalances.loan).toBe(-1212);
    expect(result.summary.finalNetWorth).toBe(-1212);
  });

  it("applies both interest charge and payment on same date", () => {
    const pack = createBasePack({
      checkpoints: [
        { Date: "2026-01-01", AccountId: "checking", Balance: 1000 },
        { Date: "2026-01-01", AccountId: "loan_interest", Balance: -100 },
        { Date: "2026-01-01", AccountId: "loan_principal", Balance: -1000 },
      ],
      accounts: [
        makeAccount({ id: "checking", minBalance: 0 }),
        makeAccount({ id: "loan_interest", maxBalance: 0 }),
        makeAccount({ id: "loan_principal", maxBalance: 0 }),
      ],
      postings: [
        makePosting({
          id: "interest", sourceAccountId: "loan_interest",
          arithmetic: "abs(loan_principal) * rate", frequency: "monthly",
          annualRate: 0.12, startDate: "2026-02-01", endDate: "2026-02-01", priority: 1,
        }),
        makePosting({
          id: "payment", sourceAccountId: "checking",
          destinations: ["loan_interest", "loan_principal"],
          arithmetic: "200", frequency: "monthly",
          startDate: "2026-02-01", endDate: "2026-02-01", priority: 2,
        }),
      ],
    });

    const result = projectScenarioPack(pack, makeSettings());
    const row = result.timeline.rows[1]!;

    expect(row.accountBalances.loan_interest).toBeGreaterThan(-100);
    expect(row.accountBalances.loan_principal).toBeGreaterThan(-1000);
    expect(row.netWorth).toBeGreaterThan(-1100);
    expect(row.realizedPostingAmount).toBe(210);
    expect(row.accountBalances.checking).toBe(800);
  });

  it("prevents destination accounts from exceeding maxBalance (overpayment guard)", () => {
    const pack = createBasePack({
      checkpoints: [
        { Date: "2026-01-01", AccountId: "checking", Balance: 400 },
        { Date: "2026-01-01", AccountId: "loan", Balance: -300 },
      ],
      accounts: [
        makeAccount({ id: "checking" }),
        makeAccount({ id: "loan", maxBalance: 0 }),
      ],
      postings: [
        makePosting({ id: "paydown", sourceAccountId: "checking", destinations: ["loan"], arithmetic: "400", startDate: "2026-01-10", endDate: "2026-01-10" }),
      ],
    });

    const result = projectScenarioPack(pack, makeSettings());

    expect(result.timeline.rows[1]?.requestedPostingAmount).toBe(400);
    expect(result.timeline.rows[1]?.realizedPostingAmount).toBe(300);
    expect(result.timeline.rows[1]?.clampedPostingShortfallAmount).toBe(100);
    expect(result.timeline.rows[1]?.accountBalances.loan).toBe(0);
    expect(result.timeline.rows[1]?.accountBalances.checking).toBe(100);
    expect(result.timeline.rows[1]?.netWorth).toBe(100);
  });

  it("prevents source accounts from falling below minBalance", () => {
    const pack = createBasePack({
      checkpoints: [
        { Date: "2026-01-01", AccountId: "checking", Balance: 300 },
      ],
      accounts: [
        makeAccount({ id: "checking", minBalance: 100 }),
        makeAccount({ id: "brokerage" }),
      ],
      postings: [
        makePosting({ id: "transfer", sourceAccountId: "checking", destinations: ["brokerage"], arithmetic: "400", startDate: "2026-01-10", endDate: "2026-01-10" }),
      ],
    });

    const result = projectScenarioPack(pack, makeSettings());

    expect(result.timeline.rows[1]?.realizedPostingAmount).toBe(200);
    expect(result.timeline.rows[1]?.clampedPostingShortfallAmount).toBe(200);
    expect(result.timeline.rows[1]?.accountBalances.checking).toBe(100);
  });
});
