import type { Posting, ScenarioWhatIfState, IsoDate } from "../types/scenario";
import {
  getHeadroom,
  getTotalDestinationHeadroom,
  getWithdrawableAmount,
} from "./accountEngine";
import type { Account } from "../types/scenario";
import { addMonthsClamped, compareIsoDates } from "../utils/date";

export interface DatedPostingOccurrence {
  posting: Posting;
  monthsElapsed: number;
  index: number;
}

export function addMonthlyOccurrences(
  postings: Posting[],
  eventDates: Map<IsoDate, DatedPostingOccurrence[]>,
  projectionStartDate: IsoDate,
  projectionEndDate: IsoDate,
  includeStartDate: boolean
): void {
  postings.forEach((posting, index) => {
    if (!posting.enabled) {
      return;
    }

    const effectiveEndDate = posting.endDate !== null && compareIsoDates(posting.endDate, projectionEndDate) < 0
      ? posting.endDate
      : projectionEndDate;

    for (let monthsElapsed = 0; ; monthsElapsed += 1) {
      const occurrenceDate = addMonthsClamped(posting.startDate, monthsElapsed);
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
      occurrences.push({ posting, monthsElapsed, index });
      eventDates.set(occurrenceDate, occurrences);
    }
  });
}

export function applyAnnualGrowth(
  amount: number,
  annualGrowthRate: number,
  monthsElapsed: number
): number {
  if (amount === 0 || annualGrowthRate === 0 || monthsElapsed <= 0) {
    return amount;
  }

  return amount * Math.pow(1 + annualGrowthRate, monthsElapsed / 12);
}

export function computeRequestedAmount(
  occurrence: DatedPostingOccurrence,
  latestRealizedPostingAmountById: Map<string, number>,
  balances: Record<string, number>,
  whatIfState: ScenarioWhatIfState
): number {
  const { posting, monthsElapsed } = occurrence;
  const override = whatIfState.postingOverrides[posting.id];

  if (override?.mode === "amount") {
    return Math.max(0, override.value);
  }

  const multiplier = override?.mode === "multiplier" ? Math.max(0, override.value) : 1;

  let baseValue = 0;

  if (posting.amountMode === "percent_of_base" && posting.basePostingId !== null) {
    const postingBase = latestRealizedPostingAmountById.get(posting.basePostingId);
    const accountBase = balances[posting.basePostingId];

    baseValue = postingBase !== undefined ? postingBase
      : accountBase !== undefined ? accountBase
      : 0;

    if (posting.absBase) {
      baseValue = Math.abs(baseValue);
    }
  }

  const baseAmount = posting.amountMode === "fixed"
    ? posting.amount
    : baseValue * posting.amount;

  return applyAnnualGrowth(baseAmount, posting.annualGrowthRate, monthsElapsed) * multiplier;
}

export function resolvePostingAmount(
  posting: Posting,
  requestedAmount: number,
  annualCapRemaining: number,
  balances: Record<string, number>,
  accountById: Map<string, Account>
): number {
  if (requestedAmount <= 0) {
    return 0;
  }

  if (posting.sourceAccountId !== null && !accountById.has(posting.sourceAccountId)) {
    return 0;
  }

  const sourceBalanceLimit = posting.sourceAccountId === null
    ? Number.POSITIVE_INFINITY
    : getWithdrawableAmount(balances, accountById, posting.sourceAccountId);

  const destBalanceLimit = posting.destinations === null
    ? Number.POSITIVE_INFINITY
    : getTotalDestinationHeadroom(balances, accountById, posting.destinations);

  return Math.max(0, Math.min(requestedAmount, annualCapRemaining, sourceBalanceLimit, destBalanceLimit));
}

export function applyPosting(
  posting: Posting,
  realizedAmount: number,
  balances: Record<string, number>,
  accountById: Map<string, Account>
): void {
  if (realizedAmount <= 0) {
    return;
  }

  if (posting.sourceAccountId !== null) {
    balances[posting.sourceAccountId] = (balances[posting.sourceAccountId] ?? 0) - realizedAmount;
  }

  if (posting.destinations === null) {
    return;
  }

  let remaining = realizedAmount;

  for (const destId of posting.destinations) {
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
