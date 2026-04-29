import type { AllocationPolicyDefinition } from "../../../types";
import { afterTaxAllocation } from "./afterTaxAllocation";

export const allocationPolicies: AllocationPolicyDefinition[] = [
  afterTaxAllocation,
];
