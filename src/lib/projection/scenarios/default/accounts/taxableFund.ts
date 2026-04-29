import { MODEL } from "../../../model";
import type { ScenarioAccountDefinition } from "../../../types";

export const taxableFund: ScenarioAccountDefinition = {
  id: "taxableFund",
  label: MODEL.accounts.taxableFund.label,
  kind: "asset",
  openingBalance: 40000,
  annualRate: 0.05,
  color: MODEL.accounts.taxableFund.color,
  minBalance: 0,
};
