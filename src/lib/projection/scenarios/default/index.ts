import { MODEL } from "../../model";
import type { ScenarioDefinition } from "../../types";
import { accounts } from "./accounts";
import { modules } from "./modules";
import { allocationPolicies } from "./policies";

export const DEFAULT_SCENARIO_DEFINITION: ScenarioDefinition = {
  version: 2,
  name: "Default scenario",
  startDate: new Date().toISOString().slice(0, 7), // e.g. "2024-01"
  horizonMonths: 600,
  targetNetWorth: MODEL.targetNetWorth,
  accounts,
  modules,
  allocationPolicies,
};
