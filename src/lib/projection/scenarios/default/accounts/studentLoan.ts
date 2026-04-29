import { MODEL } from "../../../model";
import type { ScenarioAccountDefinition } from "../../../types";

export const studentLoan: ScenarioAccountDefinition = {
  id: "studentLoan",
  label: MODEL.accounts.studentLoan.label,
  kind: "liability",
  openingBalance: 60000,
  annualRate: 0.13,
  color: MODEL.accounts.studentLoan.color,
  minBalance: 0,
};
