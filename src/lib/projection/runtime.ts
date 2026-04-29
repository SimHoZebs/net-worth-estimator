import { createEvent } from "./eventGenerators";
import type {
  EventType,
  ProjectionEvent,
  ProjectionPlan,
  RuntimeMonthState,
  RuntimeOperation,
  RuntimeRateRule,
} from "./types";

interface RuntimeExecution {
  monthStates: RuntimeMonthState[];
  generatedEvents: ProjectionEvent[];
  hitTargetMonth: number | null;
}

function groupOperationsByMonth(operations: RuntimeOperation[]): Map<number, RuntimeOperation[]> {
  const byMonth = new Map<number, RuntimeOperation[]>();

  operations.forEach((operation) => {
    if (!byMonth.has(operation.month)) byMonth.set(operation.month, []);
    byMonth.get(operation.month)?.push(operation);
  });

  return byMonth;
}

function groupRateRulesByMonth(rateRules: RuntimeRateRule[], horizonMonths: number): Map<number, RuntimeRateRule[]> {
  const byMonth = new Map<number, RuntimeRateRule[]>();

  for (let month = 0; month < horizonMonths; month += 1) {
    byMonth.set(month, []);
  }

  rateRules.forEach((rule) => {
    for (let month = rule.startMonth; month <= Math.min(rule.endMonth, horizonMonths - 1); month += 1) {
      byMonth.get(month)?.push(rule);
    }
  });

  return byMonth;
}

function applyOperation(balances: Record<string, number>, operation: RuntimeOperation): void {
  operation.effects.forEach((effect) => {
    balances[effect.accountId] = (balances[effect.accountId] ?? 0) + effect.delta;
  });
}

function operationToEvent(operation: RuntimeOperation): ProjectionEvent {
  return createEvent({
    month: operation.month,
    type: operation.type,
    amount: operation.amount,
    source: operation.source,
    destination: operation.destination,
    taxTreatment: operation.taxTreatment,
    meta: operation.meta,
  });
}

function createOperation({
  month,
  amount,
  type,
  source,
  destination,
  taxTreatment,
  meta,
  effects,
  emitEvent = true,
}: {
  month: number;
  amount: number;
  type: EventType;
  source?: string;
  destination?: string;
  taxTreatment?: string;
  meta?: Record<string, unknown>;
  effects: RuntimeOperation["effects"];
  emitEvent?: boolean;
}): RuntimeOperation {
  return {
    month,
    amount,
    type,
    emitEvent,
    source,
    destination,
    taxTreatment,
    meta,
    effects,
  };
}

function enforceMinimumBalances({
  month,
  balances,
  accounts,
  emitShortfallEvents,
}: {
  month: number;
  balances: Record<string, number>;
  accounts: ProjectionPlan["scenario"]["accounts"];
  emitShortfallEvents: boolean;
}): RuntimeOperation[] {
  const operations: RuntimeOperation[] = [];

  accounts.forEach((account) => {
    const minBalance = account.minBalance ?? Number.NEGATIVE_INFINITY;
    const currentBalance = balances[account.id] ?? 0;

    if (currentBalance >= minBalance) return;

    const deficit = minBalance - currentBalance;
    balances[account.id] = minBalance;

    if (emitShortfallEvents && account.id === "cash" && deficit > 0) {
      operations.push(
        createOperation({
          month,
          amount: deficit,
          type: "shortfall",
          source: "cash-flow-shortfall",
          taxTreatment: "after-tax",
          effects: [],
        })
      );
    }
  });

  return operations;
}

function calculateNetWorth(balances: Record<string, number>, accounts: ProjectionPlan["scenario"]["accounts"]): number {
  return accounts.reduce((total, account) => {
    const balance = balances[account.id] ?? 0;
    if (account.id === "cash") return total;
    return total + (account.kind === "liability" ? -balance : balance);
  }, 0);
}

function executeAllocationPolicies({
  month,
  balances,
  plan,
}: {
  month: number;
  balances: Record<string, number>;
  plan: ProjectionPlan;
}): {
  operations: RuntimeOperation[];
  requestedAllocation: number;
  availableCashBeforeAllocation: number;
  realizedAllocation: number;
  sweptRemainder: number;
  usedAllocationOverride: boolean;
} {
  const operations: RuntimeOperation[] = [];
  let requestedAllocation = 0;
  let availableCashBeforeAllocation = 0;
  let realizedAllocation = 0;
  let sweptRemainder = 0;
  let usedAllocationOverride = false;

  plan.scenario.allocationPolicies.forEach((policy) => {
    const sourceBalance = Math.max(0, balances[policy.sourceAccountId] ?? 0);
    const override = policy.overrides.find((entry) => entry.month === month);
    const policyRequestedAmount = sourceBalance * policy.rateOfAvailable;
    let remaining = override ? sourceBalance : Math.min(policyRequestedAmount, sourceBalance);

    availableCashBeforeAllocation += sourceBalance;
    requestedAllocation += override
      ? override.steps.reduce((sum, step) => sum + step.amount, 0)
      : policyRequestedAmount;
    usedAllocationOverride = usedAllocationOverride || Boolean(override);

    if (override) {
      override.steps.forEach((step) => {
        if (remaining <= 0 || step.amount <= 0) return;

        const destinationBalance = balances[step.destinationAccountId] ?? 0;
        const cappedAmount = step.destinationDeltaSign === -1
          ? Math.min(step.amount, remaining, destinationBalance)
          : Math.min(step.amount, remaining);

        if (cappedAmount <= 0) return;

        const operation = createOperation({
          month,
          amount: cappedAmount,
          type: step.destinationDeltaSign === -1 ? "debt_payment" : "transfer",
          source: "after-tax-cash",
          destination: step.destinationAccountId,
          taxTreatment: "after-tax",
          effects: [
            { accountId: policy.sourceAccountId, delta: -cappedAmount },
            { accountId: step.destinationAccountId, delta: step.destinationDeltaSign * cappedAmount },
          ],
        });

        applyOperation(balances, operation);
        operations.push(operation);
        realizedAllocation += cappedAmount;
        remaining -= cappedAmount;
      });
    } else {
      policy.steps.forEach((step) => {
        if (remaining <= 0) return;

        const destinationBalance = balances[step.destinationAccountId] ?? 0;
        const amount = step.mode === "reduceToZero"
          ? Math.min(remaining, destinationBalance)
          : remaining;

        if (amount <= 0) return;

        const operation = createOperation({
          month,
          amount,
          type: step.destinationDeltaSign === -1 ? "debt_payment" : "transfer",
          source: "after-tax-cash",
          destination: step.destinationAccountId,
          taxTreatment: "after-tax",
          effects: [
            { accountId: policy.sourceAccountId, delta: -amount },
            { accountId: step.destinationAccountId, delta: step.destinationDeltaSign * amount },
          ],
        });

        applyOperation(balances, operation);
        operations.push(operation);
        realizedAllocation += amount;
        remaining -= amount;
      });
    }

    if (policy.sweepRemainderFromSource) {
      const remainder = Math.max(0, balances[policy.sourceAccountId] ?? 0);
      if (remainder > 0) {
        balances[policy.sourceAccountId] -= remainder;
        sweptRemainder += remainder;
      }
    }
  });

  return {
    operations,
    requestedAllocation,
    availableCashBeforeAllocation,
    realizedAllocation,
    sweptRemainder,
    usedAllocationOverride,
  };
}

export function executeProjectionPlan(plan: ProjectionPlan): RuntimeExecution {
  const balances = Object.fromEntries(plan.scenario.accounts.map((account) => [account.id, account.openingBalance]));
  const scheduledOperationsByMonth = groupOperationsByMonth(plan.scheduledOperations);
  const rateRulesByMonth = groupRateRulesByMonth(plan.rateRules, plan.scenario.horizonMonths);
  const generatedEvents: ProjectionEvent[] = [];
  const monthStates: RuntimeMonthState[] = [];
  let hitTargetMonth: number | null = null;

  for (let month = 0; month < plan.scenario.horizonMonths; month += 1) {
    const rateRuleOperations: RuntimeOperation[] = [];
    const baseOperations = scheduledOperationsByMonth.get(month) ?? [];

    (rateRulesByMonth.get(month) ?? []).forEach((rule) => {
      const baseBalance = balances[rule.accountId] ?? 0;
      if (baseBalance <= 0 || rule.monthlyRate <= 0) return;

      const amount = baseBalance * rule.monthlyRate;
      const operation = createOperation({
        month,
        amount,
        type: rule.type,
        source: rule.source,
        destination: rule.destination,
        taxTreatment: rule.taxTreatment,
        emitEvent: rule.emitEvent,
        meta: rule.meta,
        effects: [{ accountId: rule.accountId, delta: amount }],
      });

      applyOperation(balances, operation);
      rateRuleOperations.push(operation);
      if (operation.emitEvent) generatedEvents.push(operationToEvent(operation));
    });

    baseOperations.forEach((operation) => {
      applyOperation(balances, operation);
      if (operation.emitEvent) generatedEvents.push(operationToEvent(operation));
    });

    const shortfallOperations = enforceMinimumBalances({
      month,
      balances,
      accounts: plan.scenario.accounts,
      emitShortfallEvents: true,
    });
    shortfallOperations.forEach((operation) => {
      if (operation.emitEvent) generatedEvents.push(operationToEvent(operation));
    });

    const allocationExecution = executeAllocationPolicies({
      month,
      balances,
      plan,
    });
    allocationExecution.operations.forEach((operation) => {
      if (operation.emitEvent) generatedEvents.push(operationToEvent(operation));
    });

    enforceMinimumBalances({
      month,
      balances,
      accounts: plan.scenario.accounts,
      emitShortfallEvents: false,
    });

    monthStates.push({
      month,
      balances: { ...balances },
      baseOperations,
      rateRuleOperations,
      shortfallOperations,
      policyOperations: allocationExecution.operations,
      availableCashBeforeAllocation: allocationExecution.availableCashBeforeAllocation,
      requestedAllocation: allocationExecution.requestedAllocation,
      realizedAllocation: allocationExecution.realizedAllocation,
      sweptRemainder: allocationExecution.sweptRemainder,
      usedAllocationOverride: allocationExecution.usedAllocationOverride,
    });

    if (hitTargetMonth === null && calculateNetWorth(balances, plan.scenario.accounts) >= plan.scenario.targetNetWorth) {
      hitTargetMonth = month;
      break;
    }
  }

  return {
    monthStates,
    generatedEvents,
    hitTargetMonth,
  };
}
