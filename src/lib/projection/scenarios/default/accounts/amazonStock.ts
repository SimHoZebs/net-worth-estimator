import { MODEL } from "../../../model";
import type { ScenarioAccountDefinition } from "../../../types";

export const amazonStock: ScenarioAccountDefinition = {
  id: "amazonStock",
  label: MODEL.accounts.amazonStock.label,
  kind: "asset",
  openingBalance: 0,
  annualRate: 0.05,
  color: MODEL.accounts.amazonStock.color,
  minBalance: 0,
};
