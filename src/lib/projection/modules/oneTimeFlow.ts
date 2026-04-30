import { createEvent } from "../utils";
import type { OneTimeFlowModule } from "../types";
import type { BuiltInModulePlugin } from "./base";
import { createId } from "./base";

function buildOneTimeFlowEvent(module: OneTimeFlowModule) {
  if (module.amount <= 0 || module.month < 0) return [];

  return [
    createEvent({
      month: module.month,
      amount: module.amount,
      type: module.eventType,
      source: module.source,
      taxTreatment: module.taxTreatment,
    }),
  ];
}

export const oneTimeFlowModule: BuiltInModulePlugin<OneTimeFlowModule> = {
  definition: {
    type: "oneTimeFlow",
    title: "One-time flow",
    description: "A single after-tax income or expense event in a specific month.",
    singleton: false,
    createDefault: ({ scenario }) => ({
      id: createId("one-time-flow", scenario.modules.map((currentModule) => currentModule.id)),
      type: "oneTimeFlow",
      label: "New one-time flow",
      amount: 0,
      month: 0,
      eventType: "expense",
      source: createId("one-time-flow-source", scenario.modules.map((currentModule) => currentModule.id)),
      taxTreatment: "after-tax",
    }),
  },
  validate: (module, { moduleIndex, scenario }) => {
    const issues = [];

    if (!module.label.trim()) {
      issues.push({ code: "module.oneTime.label.empty", message: "One-time flow label is empty.", path: ["modules", moduleIndex, "label"], severity: "warning" as const });
    }
    if (module.amount < 0) {
      issues.push({ code: "module.oneTime.amount.invalid", message: "One-time flow amount must be zero or greater.", path: ["modules", moduleIndex, "amount"], severity: "error" as const });
    }
    if (module.month < 0) {
      issues.push({ code: "module.oneTime.month.invalid", message: "One-time flow month must be zero or greater.", path: ["modules", moduleIndex, "month"], severity: "error" as const });
    }
    if (module.month >= scenario.horizonMonths) {
      issues.push({ code: "module.oneTime.month.outOfRange", message: "One-time flow occurs after the current projection horizon and will not run.", path: ["modules", moduleIndex, "month"], severity: "warning" as const });
    }

    return issues;
  },
  compile: (module, context) => {
    const events = buildOneTimeFlowEvent(module);
    if (events.length === 0) return {};

    const [event] = events;
    if (!event) return {};

    switch (context.stage) {
      case "events":
        return { externalEvents: [event] };
      case "runtime":
        return {
          scheduledOperations: [
            {
              month: event.month ?? 0,
              amount: event.amount,
              emitEvent: false,
              type: event.type,
              source: event.source,
              taxTreatment: event.taxTreatment,
              effects: [{ accountId: "cash", delta: event.type === "expense" ? -event.amount : event.amount }],
            },
          ],
        };
      default:
        return {};
    }
  },
};
