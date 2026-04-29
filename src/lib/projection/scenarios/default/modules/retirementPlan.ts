import { EMPLOYEE_401K_LIMIT_2026 } from "../../../model";
import type { RetirementPlanModule } from "../../../types";

export const retirementPlan: RetirementPlanModule = {
  id: "retirement-plan",
  type: "retirementPlan",
  destinationAccountId: "k401",
  annualEmployeeLimit: EMPLOYEE_401K_LIMIT_2026,
  employeeContributionRate: 0.04,
  employerMatchRate: 0.5,
  employerMatchLimitRate: 0.04,
  firstMonthOverride: {
    enabled: true,
    employeeContribution: 0,
    employerContribution: 0,
  },
};
