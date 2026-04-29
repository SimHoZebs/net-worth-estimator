import type { RecurringFlowModule } from "../../../types";

export const otherFixedExpenses: RecurringFlowModule = {
  id: "other-fixed-expenses",
  type: "recurringFlow",
  label: "Other fixed expenses",
  amount: 0,
  startMonth: 0,
  endMonth: null,
  eventType: "expense",
  source: "other-fixed-expenses",
  taxTreatment: "after-tax",
};
