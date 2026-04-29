import type { EmploymentIncomeModule } from "../../../types";

export const employment: EmploymentIncomeModule = {
  id: "employment",
  type: "employmentIncome",
  annualBaseSalary: 129000,
  annualRaiseRate: 0.03,
  firstMonthActualPaycheck: {
    enabled: true,
    regularGross: 9283.83,
    signingBonus: 50100,
    takeHome: 41330.61,
  },
};
