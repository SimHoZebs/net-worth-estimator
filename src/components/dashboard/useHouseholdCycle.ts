import { useMemo } from "react";
import { useStore } from "@/store";
import {
	computeHouseholdCycle,
	DEFAULT_HOUSEHOLD_CYCLE_INPUTS,
	type HouseholdCycleInputs,
	latestCheckingBalance,
	latestSyncBalance,
	seedExposureFromSync,
} from "./householdCycle";

export interface HouseholdCycleState {
	inputs: HouseholdCycleInputs;
	result: ReturnType<typeof computeHouseholdCycle>;
	syncBalance: ReturnType<typeof latestSyncBalance>;
	unclassified: ReturnType<typeof seedExposureFromSync>["unclassified"];
	set: (key: keyof HouseholdCycleInputs) => (raw: string) => void;
	reset: () => void;
}

function parseAmount(raw: string): number {
	const value = Number(raw);
	return Number.isFinite(value) ? value : 0;
}

/**
 * Shared household-cycle state. Seeds follow the loaded document until the
 * user overrides a field in Settings; Results renders the resolved inputs
 * read-only, mirroring the evaluation ConfigEditor/ResultRenderer split.
 */
export function useHouseholdCycle(
	document: Parameters<typeof seedExposureFromSync>[0] | null | undefined,
): HouseholdCycleState | null {
	const overrides = useStore((state) => state.householdCycleOverrides);
	const setHouseholdCycleInput = useStore(
		(state) => state.setHouseholdCycleInput,
	);
	const resetHouseholdCycleInputs = useStore(
		(state) => state.resetHouseholdCycleInputs,
	);

	const state = useMemo(() => {
		if (!document) return null;
		const syncSeed = seedExposureFromSync(document);
		const inputs: HouseholdCycleInputs = {
			checkingBalance:
				overrides.checkingBalance ??
				latestCheckingBalance(document) ??
				DEFAULT_HOUSEHOLD_CYCLE_INPUTS.checkingBalance,
			unpaidCashObligations:
				overrides.unpaidCashObligations ??
				DEFAULT_HOUSEHOLD_CYCLE_INPUTS.unpaidCashObligations,
			primeExposure: overrides.primeExposure ?? syncSeed.prime,
			ultimateExposure: overrides.ultimateExposure ?? syncSeed.ultimate,
			wifeCurrentCycle: overrides.wifeCurrentCycle ?? syncSeed.wife,
			expectedPaycheck:
				overrides.expectedPaycheck ??
				DEFAULT_HOUSEHOLD_CYCLE_INPUTS.expectedPaycheck,
			nextMonthFixedObligations:
				overrides.nextMonthFixedObligations ??
				DEFAULT_HOUSEHOLD_CYCLE_INPUTS.nextMonthFixedObligations,
			protectedReserve:
				overrides.protectedReserve ??
				DEFAULT_HOUSEHOLD_CYCLE_INPUTS.protectedReserve,
		};
		return {
			inputs,
			result: computeHouseholdCycle(inputs),
			syncBalance: latestSyncBalance(document),
			unclassified: syncSeed.unclassified,
		};
	}, [document, overrides]);

	return useMemo(() => {
		if (!state) return null;
		const set = (key: keyof HouseholdCycleInputs) => (raw: string) =>
			setHouseholdCycleInput(key, parseAmount(raw));
		return { ...state, set, reset: resetHouseholdCycleInputs };
	}, [state, setHouseholdCycleInput, resetHouseholdCycleInputs]);
}
