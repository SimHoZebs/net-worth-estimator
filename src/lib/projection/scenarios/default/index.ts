import { MODEL } from "../../model";
import type { ScenarioDefinition } from "../../types";
import { accounts } from "./accounts";
import { modules } from "./modules";
import { allocationPolicies } from "./policies";

export const DEFAULT_SCENARIO_DEFINITION: ScenarioDefinition = {
  version: 2,
  name: "Default scenario",
  horizonMonths: 600,
  targetNetWorth: MODEL.targetNetWorth,
  accounts,
  modules,
  allocationPolicies,
};
