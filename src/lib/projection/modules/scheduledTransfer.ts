import { createEvent } from "../utils";
import type { ScheduledTransferModule } from "../types";
import type { BuiltInModulePlugin } from "./base";
import { createId, getFirstAccountIdByKind, getFirstNonCashAccountId } from "./base";

function buildTransferMonths(module: ScheduledTransferModule, horizonMonths: number): number[] {
  const months: number[] = [];
  const lastMonth = module.endMonth ?? horizonMonths - 1;

  if (module.amount <= 0 || module.startMonth < 0 || module.frequencyMonths < 1) return months;

  for (let month = module.startMonth; month <= Math.min(lastMonth, horizonMonths - 1); month += module.frequencyMonths) {
    months.push(month);
  }

  return months;
}

export const scheduledTransferModule: BuiltInModulePlugin<ScheduledTransferModule> = {
  definition: {
    type: "scheduledTransfer",
    title: "Scheduled transfer",
    description: "Moves a fixed amount between accounts on a recurring schedule.",
    singleton: false,
    createDefault: ({ scenario }) => ({
      id: createId("scheduled-transfer", scenario.modules.map((currentModule) => currentModule.id)),
      type: "scheduledTransfer",
      label: "New scheduled transfer",
      sourceAccountId: getFirstAccountIdByKind(scenario.accounts, "cash") ?? scenario.accounts[0]?.id ?? "cash",
      destinationAccountId: getFirstNonCashAccountId(scenario.accounts) ?? scenario.accounts[0]?.id ?? "cash",
      amount: 0,
      startMonth: 0,
      endMonth: null,
      frequencyMonths: 1,
      destinationDeltaSign: 1,
      eventType: "transfer",
      taxTreatment: "after-tax",
    }),
  },
  validate: (module, { moduleIndex, accountMap }) => {
    const issues = [];

    if (!accountMap.has(module.sourceAccountId)) {
      issues.push({ code: "module.transfer.source.missing", message: `Scheduled transfer source account '${module.sourceAccountId}' does not exist.`, path: ["modules", moduleIndex, "sourceAccountId"], severity: "error" as const });
    }
    if (!accountMap.has(module.destinationAccountId)) {
      issues.push({ code: "module.transfer.destination.missing", message: `Scheduled transfer destination account '${module.destinationAccountId}' does not exist.`, path: ["modules", moduleIndex, "destinationAccountId"], severity: "error" as const });
    }
    if (module.sourceAccountId === module.destinationAccountId) {
      issues.push({ code: "module.transfer.circular", message: "Scheduled transfer source and destination are the same account.", path: ["modules", moduleIndex], severity: "warning" as const });
    }
    if (module.amount < 0) {
      issues.push({ code: "module.transfer.amount.invalid", message: "Scheduled transfer amount must be zero or greater.", path: ["modules", moduleIndex, "amount"], severity: "error" as const });
    }
    if (module.startMonth < 0) {
      issues.push({ code: "module.transfer.startMonth.invalid", message: "Transfer start month must be zero or greater.", path: ["modules", moduleIndex, "startMonth"], severity: "error" as const });
    }
    if (module.endMonth !== null && module.endMonth < module.startMonth) {
      issues.push({ code: "module.transfer.endMonth.invalid", message: "Transfer end month must be greater than or equal to start month.", path: ["modules", moduleIndex, "endMonth"], severity: "error" as const });
    }
    if (module.frequencyMonths < 1) {
      issues.push({ code: "module.transfer.frequency.invalid", message: "Transfer frequency must be at least 1 month.", path: ["modules", moduleIndex, "frequencyMonths"], severity: "error" as const });
    }

    return issues;
  },
  compile: (module, context) => {
    const months = buildTransferMonths(module, context.horizonMonths);
    const externalEvents = months.map((month) =>
      createEvent({
        month,
        amount: module.amount,
        type: module.eventType,
        source: module.sourceAccountId,
        destination: module.destinationAccountId,
        taxTreatment: module.taxTreatment,
      })
    );
    const scheduledOperations = months.map((month) => ({
      month,
      amount: module.amount,
      emitEvent: false,
      type: module.eventType,
      source: module.sourceAccountId,
      destination: module.destinationAccountId,
      taxTreatment: module.taxTreatment,
      effects: [
        { accountId: module.sourceAccountId, delta: -module.amount },
        { accountId: module.destinationAccountId, delta: module.destinationDeltaSign * module.amount },
      ],
    }));

    return {
      externalEvents: context.stage === "events" ? externalEvents : [],
      scheduledOperations: context.stage === "runtime" ? scheduledOperations : [],
    };
  },
};
