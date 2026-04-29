import type { ScenarioAccountDefinition } from "../../../types";
import { cash } from "./cash";
import { k401 } from "./k401";
import { taxableFund } from "./taxableFund";
import { amazonStock } from "./amazonStock";
import { studentLoan } from "./studentLoan";

export const accounts: ScenarioAccountDefinition[] = [
  cash,
  k401,
  taxableFund,
  amazonStock,
  studentLoan,
];
