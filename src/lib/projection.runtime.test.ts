import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO_DEFINITION, compileProjectionPlan, executeProjectionPlan } from "./projection";
import type { ProjectionPlan } from "./projection";

describe("generic projection runtime", () => {
  it("executes generic operations, rate rules, and allocation policies", () => {
    const plan: ProjectionPlan = {
      scenario: {
        version: 2,
  startDate: "2024-01",
        name: "runtime only",
        horizonMonths: 1,
        targetNetWorth: 10_000,
        accounts: [
          { id: "cash", label: "Cash", kind: "cash", openingBalance: 0, minBalance: 0 },
          { id: "debt", label: "Debt", kind: "liability", openingBalance: 300, minBalance: 0 },
          { id: "fund", label: "Fund", kind: "asset", openingBalance: 100, minBalance: 0 },
        ],
        modules: [],
        allocationPolicies: [
          {
            id: "surplus",
            sourceAccountId: "cash",
            rateOfAvailable: 0.5,
            sweepRemainderFromSource: true,
            steps: [
              { destinationAccountId: "debt", destinationDeltaSign: -1, mode: "reduceToZero" },
              { destinationAccountId: "fund", destinationDeltaSign: 1, mode: "allRemaining" },
            ],
            overrides: [],
          },
        ],
      },
      externalEvents: [],
      annualTaxPlan: [],
      checkpointsByMonth: new Map(),
      scheduledOperations: [
        {
          month: 0,
          amount: 1000,
          emitEvent: false,
          type: "ordinary_income",
          source: "generic-inflow",
          effects: [{ accountId: "cash", delta: 1000 }],
        },
        {
          month: 0,
          amount: 200,
          emitEvent: false,
          type: "expense",
          source: "generic-expense",
          effects: [{ accountId: "cash", delta: -200 }],
        },
      ],
      rateRules: [
        {
          accountId: "debt",
          startMonth: 0,
          endMonth: 0,
          monthlyRate: 0.1,
          type: "interest",
          source: "debt-interest",
          destination: "debt",
          taxTreatment: "after-tax",
          emitEvent: true,
        },
      ],
      contributionSummary: {
        annualEmployee401k: 0,
        annualEmployer401k: 0,
        monthlyEmployee401k: 0,
        monthlyEmployer401k: 0,
      },
    };

    const execution = executeProjectionPlan(plan);
    const month0 = execution.monthStates[0];

    expect(month0?.availableCashBeforeAllocation).toBe(800);
    expect(month0?.requestedAllocation).toBe(400);
    expect(month0?.realizedAllocation).toBe(400);
    expect(month0?.sweptRemainder).toBe(400);
    expect(month0?.balances.debt).toBe(0);
    expect(month0?.balances.fund).toBe(170);
    expect(month0?.balances.cash).toBe(0);
    expect(execution.generatedEvents.some((event) => event.type === "interest" && event.amount === 30)).toBe(true);
    expect(execution.generatedEvents.some((event) => event.type === "debt_payment" && event.amount === 330)).toBe(true);
    expect(execution.generatedEvents.some((event) => event.type === "transfer" && event.amount === 70)).toBe(true);
  });

  it("compiles the current scenario into built-in modules and generic accounts", () => {
    const scenarioDefinition = DEFAULT_SCENARIO_DEFINITION;
    const plan = compileProjectionPlan(DEFAULT_SCENARIO_DEFINITION);

    expect(scenarioDefinition.accounts.map((account) => account.id)).toEqual([
      "cash",
      "k401",
      "taxableFund",
      "amazonStock",
      "studentLoan",
    ]);
    expect(scenarioDefinition.modules.map((module) => module.type)).toContain("employmentIncome");
    expect(scenarioDefinition.modules.map((module) => module.type)).toContain("retirementPlan");
    expect(scenarioDefinition.modules.map((module) => module.type)).toContain("equityGrantSeries");
    expect(plan.scheduledOperations.some((operation) => operation.source === "after-tax-salary-cash")).toBe(true);
    expect(plan.rateRules.some((rule) => rule.accountId === "studentLoan" && rule.emitEvent)).toBe(true);
  });
});
