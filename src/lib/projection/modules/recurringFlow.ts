import { createEvent } from "../utils";
import type { ProjectionEvent, RecurringFlowModule, RuntimeOperation } from "../types";
import type { BuiltInModulePlugin } from "./base";
import { createId } from "./base";

function buildRecurringFlowEvents(module: RecurringFlowModule, horizonMonths: number): ProjectionEvent[] {
  const events: ProjectionEvent[] = [];
  const endMonth = module.endMonth ?? horizonMonths - 1;

  for (let month = module.startMonth; month <= Math.min(endMonth, horizonMonths - 1); month += 1) {
    events.push(
      createEvent({
        month,
        amount: module.amount,
        type: module.eventType,
        source: module.source,
        taxTreatment: module.taxTreatment,
      })
    );
  }

  return events;
}

function buildRecurringFlowOperations({
  module,
  horizonMonths,
  usesActualFirstMonthPaycheck,
}: {
  module: RecurringFlowModule;
  horizonMonths: number;
  usesActualFirstMonthPaycheck: boolean;
}): RuntimeOperation[] {
  const endMonth = module.endMonth ?? horizonMonths - 1;
  const operations: RuntimeOperation[] = [];

  for (let month = module.startMonth; month <= Math.min(endMonth, horizonMonths - 1); month += 1) {
    if (module.skipWhenActualFirstMonthPaycheck && usesActualFirstMonthPaycheck && month === 0) continue;

    operations.push({
      month,
      amount: module.amount,
      emitEvent: false,
      type: module.eventType,
      source: module.source,
      taxTreatment: module.taxTreatment,
      effects: [{ accountId: "cash", delta: module.eventType === "expense" ? -module.amount : module.amount }],
    });
  }

  return operations;
}

export const recurringFlowModule: BuiltInModulePlugin<RecurringFlowModule> = {
  definition: {
    type: "recurringFlow",
    title: "Recurring flow",
    description: "Monthly expense or after-tax cash inflow that repeats over a month range.",
    singleton: false,
    createDefault: ({ scenario }) => ({
      id: createId("recurring-flow", scenario.modules.map((currentModule) => currentModule.id)),
      type: "recurringFlow",
      label: "New recurring flow",
      amount: 0,
      startMonth: 0,
      endMonth: null,
      eventType: "expense",
      source: createId("flow", scenario.modules.map((currentModule) => currentModule.id)),
      taxTreatment: "after-tax",
    }),
  },
  validate: (module, { moduleIndex }) => {
    const issues = [];

    if (!module.label.trim()) {
      issues.push({ code: "module.recurring.label.empty", message: "Recurring flow label is empty.", path: ["modules", moduleIndex, "label"], severity: "warning" as const });
    }
    if (module.amount < 0) {
      issues.push({ code: "module.recurring.amount.invalid", message: "Recurring flow amount must be zero or greater.", path: ["modules", moduleIndex, "amount"], severity: "error" as const });
    }
    if (module.startMonth < 0) {
      issues.push({ code: "module.recurring.startMonth.invalid", message: "Start month must be zero or greater.", path: ["modules", moduleIndex, "startMonth"], severity: "error" as const });
    }
    if (module.endMonth !== null && module.endMonth < module.startMonth) {
      issues.push({ code: "module.recurring.endMonth.invalid", message: "End month must be greater than or equal to start month.", path: ["modules", moduleIndex, "endMonth"], severity: "error" as const });
    }

    return issues;
  },
  compile: (module, context) => {
    switch (context.stage) {
      case "events":
        return { externalEvents: buildRecurringFlowEvents(module, context.horizonMonths) };
      case "runtime":
        return {
          scheduledOperations: buildRecurringFlowOperations({
            module,
            horizonMonths: context.horizonMonths,
            usesActualFirstMonthPaycheck: context.facts.usesActualFirstMonthPaycheck,
          }),
        };
      default:
        return {};
    }
  },
};
