import { DEFAULT_REFRESHER_PCT_OF_BASE, MODEL } from "../../../model";
import type { EquityGrantSeriesModule } from "../../../types";

export const equityGrants: EquityGrantSeriesModule = {
  id: "equity-grants",
  type: "equityGrantSeries",
  destinationAccountId: "amazonStock",
  employeeMonthsAtProjectionStart: 24,
  initialGrantValue: 140000,
  refreshGrantValue: Math.round(129000 * DEFAULT_REFRESHER_PCT_OF_BASE),
  firstRefreshGrantMonth: 36,
  refreshFrequencyMonths: 12,
  useSalaryGrowthForRefreshers: true,
  annualRaiseRate: 0.03,
  annualBaseSalary: 129000,
  salaryLinkedRefreshPctOfBase: DEFAULT_REFRESHER_PCT_OF_BASE,
  vestingSchedule: MODEL.rsuPlans.amazonInitial.events.map((event) => ({
    monthOffset: event.month,
    pct: event.pct,
  })),
};
