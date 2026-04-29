import type { RecurringFlowModule } from "../../../types";

export const parking: RecurringFlowModule = {
  id: "parking",
  type: "recurringFlow",
  label: "Parking",
  amount: 275,
  startMonth: 0,
  endMonth: null,
  eventType: "expense",
  source: "parking",
  taxTreatment: "after-tax",
};
