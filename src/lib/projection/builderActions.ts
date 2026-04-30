import { getBuiltInModuleDefinition } from "./modules";
import type {
  AllocationOverrideStep,
  AllocationPolicyDefinition,
  ScenarioAccountDefinition,
  ScenarioDefinition,
  ScenarioModuleType,
} from "./types";

function createId(prefix: string, existingIds: string[]): string {
  const normalizedPrefix = prefix.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  let suffix = existingIds.length + 1;
  let candidate = `${normalizedPrefix}-${suffix}`;

  while (existingIds.includes(candidate)) {
    suffix += 1;
    candidate = `${normalizedPrefix}-${suffix}`;
  }

  return candidate;
}

export function isAccountReferenced(scenario: ScenarioDefinition, accountId: string): boolean {
  return scenario.modules.some((module) => {
    switch (module.type) {
      case "retirementPlan":
      case "equityGrantSeries":
        return module.destinationAccountId === accountId;
      case "scheduledTransfer":
        return module.sourceAccountId === accountId || module.destinationAccountId === accountId;
      default:
        return false;
    }
  }) || scenario.allocationPolicies.some((policy) => (
    policy.sourceAccountId === accountId ||
    policy.steps.some((step) => step.destinationAccountId === accountId) ||
    policy.overrides.some((override) => override.steps.some((step) => step.destinationAccountId === accountId))
  ));
}

export function addAccount(scenario: ScenarioDefinition, kind: ScenarioAccountDefinition["kind"]): ScenarioDefinition {
  const nextId = createId(kind, scenario.accounts.map((account) => account.id));
  const nextAccount: ScenarioAccountDefinition = {
    id: nextId,
    label: kind === "liability" ? "New liability" : "New account",
    kind,
    openingBalance: 0,
    annualRate: 0,
    color: kind === "liability" ? "#dc2626" : "#2563eb",
    minBalance: 0,
  };

  return {
    ...scenario,
    accounts: [...scenario.accounts, nextAccount],
  };
}

export function removeAccountAt(scenario: ScenarioDefinition, accountIndex: number): ScenarioDefinition {
  return {
    ...scenario,
    accounts: scenario.accounts.filter((_, index) => index !== accountIndex),
  };
}

export function addModuleByType(scenario: ScenarioDefinition, type: ScenarioModuleType): ScenarioDefinition {
  return {
    ...scenario,
    modules: [...scenario.modules, getBuiltInModuleDefinition(type).createDefault({ scenario })],
  };
}

export function removeModuleAt(scenario: ScenarioDefinition, moduleIndex: number): ScenarioDefinition {
  return {
    ...scenario,
    modules: scenario.modules.filter((_, index) => index !== moduleIndex),
  };
}

export function addPolicy(scenario: ScenarioDefinition): ScenarioDefinition {
  const sourceAccountId = scenario.accounts.find((account) => account.kind === "cash")?.id ?? scenario.accounts[0]?.id ?? "cash";
  const destinationAccountId = scenario.accounts.find((account) => account.kind !== "cash")?.id ?? sourceAccountId;

  return {
    ...scenario,
    allocationPolicies: [
      ...scenario.allocationPolicies,
      {
        id: createId("policy", scenario.allocationPolicies.map((policy) => policy.id)),
        sourceAccountId,
        rateOfAvailable: 0.1,
        sweepRemainderFromSource: true,
        steps: [{ destinationAccountId, destinationDeltaSign: 1, mode: "allRemaining" }],
        overrides: [],
      },
    ],
  };
}

export function removePolicyAt(scenario: ScenarioDefinition, policyIndex: number): ScenarioDefinition {
  return {
    ...scenario,
    allocationPolicies: scenario.allocationPolicies.filter((_, index) => index !== policyIndex),
  };
}

export function addPolicyStep(policy: AllocationPolicyDefinition, destinationAccountId: string): AllocationPolicyDefinition {
  return {
    ...policy,
    steps: [...policy.steps, { destinationAccountId, destinationDeltaSign: 1, mode: "allRemaining" }],
  };
}

export function addPolicyOverride(policy: AllocationPolicyDefinition, destinationAccountId: string): AllocationPolicyDefinition {
  return {
    ...policy,
    overrides: [
      ...policy.overrides,
      {
        month: 0,
        steps: [{ destinationAccountId, destinationDeltaSign: 1, amount: 0 }],
      },
    ],
  };
}

export function addOverrideStep(steps: AllocationOverrideStep[], destinationAccountId: string): AllocationOverrideStep[] {
  return [...steps, { destinationAccountId, destinationDeltaSign: 1, amount: 0 }];
}
