import type { ScenarioModule } from "../../../types";
import { employment } from "./employment";
import { retirementPlan } from "./retirementPlan";
import { rent } from "./rent";
import { parking } from "./parking";
import { healthDental } from "./healthDental";
import { otherFixedExpenses } from "./otherFixedExpenses";
import { equityGrants } from "./equityGrants";
import { taxes } from "./taxes";

export const modules: ScenarioModule[] = [
  employment,
  retirementPlan,
  rent,
  parking,
  healthDental,
  otherFixedExpenses,
  equityGrants,
  taxes,
];
