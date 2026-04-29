import type { ScenarioAccountDefinition } from "../../../types";

export const cash: ScenarioAccountDefinition = {
  id: "cash",
  label: "Cash",
  kind: "cash",
  openingBalance: 0,
  annualRate: 0,
  minBalance: 0,
};
