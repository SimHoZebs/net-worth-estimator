import type { RecurringFlowModule } from "../../../types";

export const rent: RecurringFlowModule = {
  id: "rent",
  type: "recurringFlow",
  label: "Rent",
  amount: 2578,
  startMonth: 0,
  endMonth: null,
  eventType: "expense",
  source: "rent",
  taxTreatment: "after-tax",
};
