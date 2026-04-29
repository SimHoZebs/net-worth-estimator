import type { RecurringFlowModule } from "../../../types";

export const healthDental: RecurringFlowModule = {
  id: "health-dental-benefits",
  type: "recurringFlow",
  label: "Health/dental benefits",
  amount: 500,
  startMonth: 0,
  endMonth: null,
  eventType: "expense",
  source: "health-dental-benefits",
  taxTreatment: "after-tax",
  skipWhenActualFirstMonthPaycheck: true,
};
