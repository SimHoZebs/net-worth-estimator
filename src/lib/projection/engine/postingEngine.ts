import type {
	Account,
	IsoDate,
	Posting,
	PostingFrequency,
	ScenarioWhatIfState,
} from "../types/scenario";
import { addMonthsClamped, compareIsoDates, daysBetween } from "../utils/date";
import {
	getHeadroom,
	getTotalDestinationHeadroom,
	getWithdrawableAmount,
} from "./accountEngine";
import { evaluateArithmetic } from "./arithmetic";

export interface DatedPostingOccurrence {
	posting: Posting;
	index: number;
}

export interface AccountMovementAction {
	sourceAccountId: string | null;
	destinations: string[] | null;
	requestedAmount: number;
	limitRemaining?: number;
}

export function frequencyDivisor(frequency: PostingFrequency): number {
	switch (frequency) {
		case "daily":
			return 365;
		case "weekly":
			return 52;
		case "monthly":
			return 12;
		case "quarterly":
			return 4;
		case "annual":
			return 1;
	}
}

function advanceDate(
	date: IsoDate,
	frequency: PostingFrequency,
	periodCount: number,
): IsoDate {
	switch (frequency) {
		case "daily":
		case "weekly": {
			const daysPerPeriod = frequency === "daily" ? 1 : 7;
			const msPerDay = 24 * 60 * 60 * 1000;
			const base = new Date(`${date}T00:00:00Z`).getTime();
			const next = new Date(base + daysPerPeriod * periodCount * msPerDay);
			return next.toISOString().slice(0, 10);
		}
		case "monthly":
			return addMonthsClamped(date, periodCount);
		case "quarterly":
			return addMonthsClamped(date, periodCount * 3);
		case "annual":
			return addMonthsClamped(date, periodCount * 12);
	}
}

export function addOccurrences(
	postings: Posting[],
	eventDates: Map<IsoDate, DatedPostingOccurrence[]>,
	projectionStartDate: IsoDate,
	projectionEndDate: IsoDate,
	includeStartDate: boolean,
): void {
	postings.forEach((posting, index) => {
		if (!posting.enabled) {
			return;
		}

		const effectiveEndDate =
			posting.endDate !== null &&
			compareIsoDates(posting.endDate, projectionEndDate) < 0
				? posting.endDate
				: projectionEndDate;

		for (let periodCount = 0; ; periodCount += 1) {
			const occurrenceDate = advanceDate(
				posting.startDate,
				posting.frequency,
				periodCount,
			);
			if (compareIsoDates(occurrenceDate, effectiveEndDate) > 0) {
				break;
			}

			const startsInWindow = includeStartDate
				? compareIsoDates(occurrenceDate, projectionStartDate) >= 0
				: compareIsoDates(occurrenceDate, projectionStartDate) > 0;

			if (!startsInWindow) {
				continue;
			}

			const occurrences = eventDates.get(occurrenceDate) ?? [];
			occurrences.push({ posting, index });
			eventDates.set(occurrenceDate, occurrences);
		}
	});
}

export function applyAnnualGrowth(
	amount: number,
	annualGrowthRate: number,
	daysElapsed: number,
): number {
	if (amount === 0 || annualGrowthRate === 0 || daysElapsed <= 0) {
		return amount;
	}

	return amount * (1 + annualGrowthRate) ** (daysElapsed / 365);
}

export function computeRequestedAmount(
	occurrence: DatedPostingOccurrence,
	currentDate: IsoDate,
	latestRealizedPostingAmountById: Map<string, number>,
	balances: Record<string, number>,
	_whatIfState: ScenarioWhatIfState,
	stochasticRate?: number,
): number {
	const { posting } = occurrence;

	const daysElapsed = daysBetween(posting.startDate, currentDate);
	const effectiveAnnualRate =
		stochasticRate !== undefined ? stochasticRate : posting.annualRate;
	const ratePerOccurrence =
		posting.annualRate === 0
			? 0
			: effectiveAnnualRate / frequencyDivisor(posting.frequency);

	const rawAmount = evaluateArithmetic(posting.arithmetic, {
		postingAmounts: latestRealizedPostingAmountById,
		accountBalances: balances,
		rate: ratePerOccurrence,
	});

	return applyAnnualGrowth(rawAmount, posting.annualGrowthRate, daysElapsed);
}

export function resolvePostingAmount(
	posting: Posting,
	requestedAmount: number,
	annualCapRemaining: number,
	balances: Record<string, number>,
	accountById: Map<string, Account>,
): number {
	return resolveAccountMovementAmount(
		{
			sourceAccountId: posting.sourceAccountId,
			destinations: posting.destinations,
			requestedAmount,
			limitRemaining: annualCapRemaining,
		},
		balances,
		accountById,
	);
}

export function resolveAccountMovementAmount(
	action: AccountMovementAction,
	balances: Record<string, number>,
	accountById: Map<string, Account>,
): number {
	if (action.requestedAmount <= 0) {
		return 0;
	}

	if (
		action.sourceAccountId !== null &&
		!accountById.has(action.sourceAccountId)
	) {
		return 0;
	}

	const sourceBalanceLimit =
		action.sourceAccountId === null
			? Number.POSITIVE_INFINITY
			: getWithdrawableAmount(balances, accountById, action.sourceAccountId);

	const destBalanceLimit =
		action.destinations === null
			? Number.POSITIVE_INFINITY
			: getTotalDestinationHeadroom(balances, accountById, action.destinations);

	return Math.max(
		0,
		Math.min(
			action.requestedAmount,
			action.limitRemaining ?? Number.POSITIVE_INFINITY,
			sourceBalanceLimit,
			destBalanceLimit,
		),
	);
}

export function applyPosting(
	posting: Posting,
	realizedAmount: number,
	balances: Record<string, number>,
	accountById: Map<string, Account>,
): void {
	applyAccountMovement(
		{
			sourceAccountId: posting.sourceAccountId,
			destinations: posting.destinations,
			requestedAmount: realizedAmount,
		},
		realizedAmount,
		balances,
		accountById,
	);
}

export function applyAccountMovement(
	action: AccountMovementAction,
	realizedAmount: number,
	balances: Record<string, number>,
	accountById: Map<string, Account>,
): void {
	if (realizedAmount <= 0) {
		return;
	}

	if (action.sourceAccountId !== null) {
		balances[action.sourceAccountId] =
			(balances[action.sourceAccountId] ?? 0) - realizedAmount;
	}

	if (action.destinations === null) {
		return;
	}

	let remaining = realizedAmount;

	for (const destId of action.destinations) {
		if (remaining <= 0) {
			break;
		}

		const headroom = getHeadroom(balances, accountById, destId);
		if (headroom <= 0) {
			continue;
		}

		const allocated = Math.min(remaining, headroom);
		balances[destId] = (balances[destId] ?? 0) + allocated;
		remaining -= allocated;
	}
}
