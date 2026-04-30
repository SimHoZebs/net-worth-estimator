import { describe, expect, it } from "vitest";
import {
  DEFAULT_SCENARIO_DEFINITION,
  addModuleByType,
  compileProjectionPlan,
  getBuiltInModuleDefinition,
  project,
  summarizeValidationIssues,
  validateScenario,
} from "./projection";

describe("scenario validation and built-in module catalog", () => {
  it("creates default generic modules from the catalog", () => {
    const oneTimeFlow = getBuiltInModuleDefinition("oneTimeFlow").createDefault({ scenario: DEFAULT_SCENARIO_DEFINITION });
    const scheduledTransfer = getBuiltInModuleDefinition("scheduledTransfer").createDefault({ scenario: DEFAULT_SCENARIO_DEFINITION });

    expect(oneTimeFlow.type).toBe("oneTimeFlow");
    expect(oneTimeFlow.eventType).toBe("expense");
    expect(scheduledTransfer.type).toBe("scheduledTransfer");
    expect(scheduledTransfer.frequencyMonths).toBe(1);
  });

  it("flags duplicate singleton modules and missing account references", () => {
    const brokenScenario = {
      ...addModuleByType(DEFAULT_SCENARIO_DEFINITION, "tax"),
      modules: [
        ...addModuleByType(DEFAULT_SCENARIO_DEFINITION, "tax").modules,
        {
          id: "broken-transfer",
          type: "scheduledTransfer" as const,
          label: "Broken transfer",
          sourceAccountId: "cash",
          destinationAccountId: "missing-account",
          amount: 100,
          startMonth: 0,
          endMonth: null,
          frequencyMonths: 1,
          destinationDeltaSign: 1 as const,
          eventType: "transfer" as const,
          taxTreatment: "after-tax",
        },
      ],
    };

    const summary = summarizeValidationIssues(validateScenario(brokenScenario));

    expect(summary.isValid).toBe(false);
    expect(summary.errors.some((issue) => issue.code === "module.singleton.duplicate")).toBe(true);
    expect(summary.errors.some((issue) => issue.code === "module.transfer.destination.missing")).toBe(true);
  });

  it("projects one-time flows and scheduled transfers through the generic runtime", () => {
    const scenario = {
      ...DEFAULT_SCENARIO_DEFINITION,
      horizonMonths: 3,
      modules: [
        ...DEFAULT_SCENARIO_DEFINITION.modules,
        {
          id: "bonus",
          type: "oneTimeFlow" as const,
          label: "Cash bonus",
          amount: 5000,
          month: 0,
          eventType: "ordinary_income" as const,
          source: "cash-bonus",
          taxTreatment: "after-tax",
        },
        {
          id: "debt-sweep",
          type: "scheduledTransfer" as const,
          label: "Extra debt payment",
          sourceAccountId: "cash",
          destinationAccountId: "studentLoan",
          amount: 750,
          startMonth: 1,
          endMonth: 1,
          frequencyMonths: 1,
          destinationDeltaSign: -1 as const,
          eventType: "debt_payment" as const,
          taxTreatment: "after-tax",
        },
      ],
    };

    const plan = compileProjectionPlan(scenario);
    const result = project(scenario);

    expect(plan.scheduledOperations.some((operation) => operation.source === "cash-bonus")).toBe(true);
    expect(plan.scheduledOperations.some((operation) => operation.destination === "studentLoan" && operation.amount === 750)).toBe(true);
    expect(result.events.external.some((event) => event.source === "cash-bonus" && event.amount === 5000)).toBe(true);
    expect(result.events.external.some((event) => event.destination === "studentLoan" && event.amount === 750)).toBe(true);
  });
});
