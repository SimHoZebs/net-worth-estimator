import { MODEL } from "../../../model";
import type { ScenarioAccountDefinition } from "../../../types";

export const k401: ScenarioAccountDefinition = {
  id: "k401",
  label: MODEL.accounts.k401.label,
  kind: "asset",
  openingBalance: 10000,
  annualRate: 0.05,
  color: MODEL.accounts.k401.color,
  minBalance: 0,
};
