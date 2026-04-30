import { EVENT_TYPES, MODEL } from "./model";
import type { AnnualTaxPlanYear, AnnualTaxes, ProjectionEvent } from "./types";
import { createEvent, sumEvents, yearLabel } from "./utils";

function calculateProgressiveTax(taxableIncome: number, brackets: ReadonlyArray<{ upTo: number; rate: number }>): number {
  let tax = 0;
  let previous = 0;

  for (const bracket of brackets) {
    if (taxableIncome <= previous) break;
    const amountInBracket = Math.min(taxableIncome, bracket.upTo) - previous;
    tax += amountInBracket * bracket.rate;
    previous = bracket.upTo;
  }

  return tax;
}

export function estimateAnnualTaxes({ ordinaryIncome, preTax401kContribution }: { ordinaryIncome: number; preTax401kContribution: number }): AnnualTaxes {
  const taxProfile = MODEL.taxProfile;
  const federalTaxableIncome = Math.max(0, ordinaryIncome - preTax401kContribution - taxProfile.standardDeduction);
  const federalIncomeTax = calculateProgressiveTax(federalTaxableIncome, taxProfile.brackets);
  const socialSecurityTax = Math.min(ordinaryIncome, taxProfile.socialSecurityWageBase) * taxProfile.socialSecurityRate;
  const medicareTax = ordinaryIncome * taxProfile.medicareRate + Math.max(0, ordinaryIncome - taxProfile.additionalMedicareThreshold) * taxProfile.additionalMedicareRate;
  const stateIncomeTax = ordinaryIncome * taxProfile.stateIncomeTaxRate;
  const totalTax = federalIncomeTax + socialSecurityTax + medicareTax + stateIncomeTax;

  return {
    federalTaxableIncome,
    federalIncomeTax,
    socialSecurityTax,
    medicareTax,
    stateIncomeTax,
    totalTax,
  };
}

export function buildAnnualTaxPlan(ledgerEvents: ProjectionEvent[], projectionLastMonth: number): AnnualTaxPlanYear[] {
  const yearCount = Math.ceil((projectionLastMonth + 1) / 12);
  const annualPlan: AnnualTaxPlanYear[] = [];

  for (let yearIndex = 0; yearIndex < yearCount; yearIndex += 1) {
    const startMonth = yearIndex * 12;
    const endMonth = Math.min(projectionLastMonth, startMonth + 11);
    const yearEvents = ledgerEvents.filter((event) => event.month !== null && event.month >= startMonth && event.month <= endMonth);
    const salaryIncome = sumEvents(yearEvents, (event) => event.type === EVENT_TYPES.ORDINARY_INCOME && event.meta?.bucket === "salary");
    const rsuIncome = sumEvents(yearEvents, (event) => event.type === EVENT_TYPES.VEST && event.taxTreatment === "ordinary-income");
    const preTax401kContribution = sumEvents(yearEvents, (event) => event.type === EVENT_TYPES.PRE_TAX_DEDUCTION);
    const ordinaryIncome = salaryIncome + rsuIncome;
    const taxes = estimateAnnualTaxes({ ordinaryIncome, preTax401kContribution });
    const totalIncomeForAllocation = Math.max(1, ordinaryIncome);

    annualPlan.push({
      yearIndex,
      label: yearLabel(startMonth),
      startMonth,
      endMonth,
      salaryIncome,
      rsuIncome,
      ordinaryIncome,
      preTax401kContribution,
      taxes,
      taxAllocatedToSalary: taxes.totalTax * (salaryIncome / totalIncomeForAllocation),
      taxAllocatedToRsus: taxes.totalTax * (rsuIncome / totalIncomeForAllocation),
    });
  }

  return annualPlan;
}

export function createTaxEvents(annualTaxPlan: AnnualTaxPlanYear[]): ProjectionEvent[] {
  return annualTaxPlan.flatMap((year) => {
    const events: ProjectionEvent[] = [];
    const activeMonths = year.endMonth - year.startMonth + 1;
    const monthlySalaryTax = year.taxAllocatedToSalary / activeMonths;
    const monthlyRsuTax = year.taxAllocatedToRsus / activeMonths;

    for (let month = year.startMonth; month <= year.endMonth; month += 1) {
      events.push(
        createEvent({
          month,
          type: EVENT_TYPES.TAX,
          amount: monthlySalaryTax,
          source: "estimated-salary-tax",
          taxTreatment: "tax-liability",
          meta: { bucket: "salary" },
        })
      );
      events.push(
        createEvent({
          month,
          type: EVENT_TYPES.TAX,
          amount: monthlyRsuTax,
          source: "estimated-rsu-tax",
          taxTreatment: "tax-liability",
          meta: { bucket: "rsu" },
        })
      );
    }

    return events;
  });
}
