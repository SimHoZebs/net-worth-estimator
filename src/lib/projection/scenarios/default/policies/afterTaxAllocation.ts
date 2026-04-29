import type { AllocationPolicyDefinition } from "../../../types";

export const afterTaxAllocation: AllocationPolicyDefinition = {
  id: "after-tax-allocation",
  sourceAccountId: "cash",
  rateOfAvailable: 0.15,
  sweepRemainderFromSource: true,
  steps: [
    { destinationAccountId: "studentLoan", destinationDeltaSign: -1, mode: "reduceToZero" },
    { destinationAccountId: "taxableFund", destinationDeltaSign: 1, mode: "allRemaining" },
  ],
  overrides: [],
};
