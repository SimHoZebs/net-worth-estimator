import type { FinancialModelDocument } from "@/lib/projection";

/**
 * Household paycheck-cycle inputs. All amounts default to $0 (protected
 * reserve defaults to $725); the user fills in live values as they change.
 * Pure UI-side derivation — never participates in simulation.
 */
export interface HouseholdCycleInputs {
	checkingBalance: number;
	unpaidCashObligations: number;
	primeExposure: number;
	ultimateExposure: number;
	wifeCurrentCycle: number;
	expectedPaycheck: number;
	nextMonthFixedObligations: number;
	protectedReserve: number;
}

export interface HouseholdCycleResult {
	cashCushion: number;
	currentCycleCommitted: number;
	theoreticalRoom: number;
	conservativeRoom: number;
}

/** Household cycle cutoff day of month (the 19th). */
export const HOUSEHOLD_CYCLE_CUTOFF_DAY = 19;

export const DEFAULT_HOUSEHOLD_CYCLE_INPUTS: HouseholdCycleInputs = {
	checkingBalance: 0,
	unpaidCashObligations: 0,
	primeExposure: 0,
	ultimateExposure: 0,
	wifeCurrentCycle: 0,
	expectedPaycheck: 0,
	nextMonthFixedObligations: 0,
	protectedReserve: 725,
};

function toFinite(value: number): number {
	return Number.isFinite(value) ? value : 0;
}

/**
 * Cash cushion = checking balance − remaining unpaid cash obligations
 * before the next paycheck. Current-cycle card charges are paid from the
 * next paycheck, never from current checking, so the two lanes stay
 * completely separate.
 */
export function computeHouseholdCycle(
	inputs: HouseholdCycleInputs,
): HouseholdCycleResult {
	const checkingBalance = toFinite(inputs.checkingBalance);
	const unpaidCashObligations = toFinite(inputs.unpaidCashObligations);
	const primeExposure = toFinite(inputs.primeExposure);
	const ultimateExposure = toFinite(inputs.ultimateExposure);
	const wifeCurrentCycle = toFinite(inputs.wifeCurrentCycle);
	const expectedPaycheck = toFinite(inputs.expectedPaycheck);
	const nextMonthFixedObligations = toFinite(inputs.nextMonthFixedObligations);
	const protectedReserve = toFinite(inputs.protectedReserve);

	const cashCushion = checkingBalance - unpaidCashObligations;
	const currentCycleCommitted =
		primeExposure + ultimateExposure + wifeCurrentCycle;
	const theoreticalRoom =
		expectedPaycheck - nextMonthFixedObligations - currentCycleCommitted;
	const conservativeRoom = theoreticalRoom - protectedReserve;

	return {
		cashCushion,
		currentCycleCommitted,
		theoreticalRoom,
		conservativeRoom,
	};
}

/**
 * Seed the checking-balance input from the latest observed checking
 * checkpoint, when one exists. Returns null when there is no observation.
 */
export function latestCheckingBalance(
	document: FinancialModelDocument,
): number | null {
	let latest: { date: string; balance: number } | null = null;
	for (const checkpoint of document.checkpoints) {
		if (checkpoint.AccountId !== "checking") continue;
		if (latest === null || checkpoint.Date > latest.date) {
			latest = { date: checkpoint.Date, balance: checkpoint.Balance };
		}
	}
	return latest?.balance ?? null;
}
