import type {
  CsvAccount,
  CsvPosting,
  CsvProjectionAccountSummary,
  CsvProjectionPostingSummary,
  CsvProjectionResult,
  CsvProjectionRow,
  CsvScenarioPack,
  CsvScenarioWhatIfState,
  IsoDate,
  ProjectionRuntimeSettings,
} from "../types/csv";
import { applyGrowth, computeNetWorth, initAccountBalances } from "./accountEngine";
import {
  addMonthlyOccurrences,
  applyPosting,
  computeRequestedAmount,
  resolvePostingAmount,
} from "./postingEngine";
import type { DatedPostingOccurrence } from "./postingEngine";
import { addYearsClamped, compareIsoDates, daysBetween } from "../utils/date";

interface NormalizedCheckpoints {
  dates: Array<{
    date: IsoDate;
    checkpoints: CsvScenarioPack["checkpoints"];
  }>;
  earliestCheckpointDate: IsoDate | null;
  latestCheckpointDate: IsoDate | null;
}

function roundCurrency(value: number): number {
  return Math.round(value);
}

function normalizeCheckpoints(pack: CsvScenarioPack): NormalizedCheckpoints {
  const checkpoints = pack.checkpoints
    .map((checkpoint, index) => ({ checkpoint, index }))
    .sort((left, right) => compareIsoDates(left.checkpoint.Date, right.checkpoint.Date) || left.index - right.index);
  const groupedByDate = new Map<IsoDate, CsvScenarioPack["checkpoints"]>();

  checkpoints.forEach(({ checkpoint }) => {
    const existing = groupedByDate.get(checkpoint.Date);
    if (existing) {
      existing.push(checkpoint);
      return;
    }

    groupedByDate.set(checkpoint.Date, [checkpoint]);
  });

  const dates = Array.from(groupedByDate.entries()).map(([date, dateCheckpoints]) => ({
    date,
    checkpoints: dateCheckpoints,
  }));

  return {
    dates,
    earliestCheckpointDate: dates[0]?.date ?? null,
    latestCheckpointDate: dates[dates.length - 1]?.date ?? null,
  };
}

function createRow({
  date,
  isHistorical,
  balances,
  accounts,
  externalInflowAmount,
  externalOutflowAmount,
  internalTransferAmount,
  requestedPostingAmount,
  realizedPostingAmount,
  clampedPostingShortfallAmount,
  growthNetWorthImpact,
  requestedPostingAmountsById,
  realizedPostingAmountsById,
}: {
  date: IsoDate;
  isHistorical: boolean;
  balances: Record<string, number>;
  accounts: CsvAccount[];
  externalInflowAmount: number;
  externalOutflowAmount: number;
  internalTransferAmount: number;
  requestedPostingAmount: number;
  realizedPostingAmount: number;
  clampedPostingShortfallAmount: number;
  growthNetWorthImpact: number;
  requestedPostingAmountsById: Record<string, number>;
  realizedPostingAmountsById: Record<string, number>;
}): CsvProjectionRow {
  return {
    date,
    isHistorical,
    netWorth: computeNetWorth(balances, accounts),
    accountBalances: { ...balances },
    externalInflowAmount,
    externalOutflowAmount,
    internalTransferAmount,
    requestedPostingAmount,
    realizedPostingAmount,
    clampedPostingShortfallAmount,
    growthNetWorthImpact,
    requestedPostingAmountsById,
    realizedPostingAmountsById,
  };
}

function roundRow(row: CsvProjectionRow): CsvProjectionRow {
  return {
    ...row,
    netWorth: roundCurrency(row.netWorth),
    externalInflowAmount: roundCurrency(row.externalInflowAmount),
    externalOutflowAmount: roundCurrency(row.externalOutflowAmount),
    internalTransferAmount: roundCurrency(row.internalTransferAmount),
    requestedPostingAmount: roundCurrency(row.requestedPostingAmount),
    realizedPostingAmount: roundCurrency(row.realizedPostingAmount),
    clampedPostingShortfallAmount: roundCurrency(row.clampedPostingShortfallAmount),
    growthNetWorthImpact: roundCurrency(row.growthNetWorthImpact),
    accountBalances: Object.fromEntries(Object.entries(row.accountBalances).map(([accountId, balance]) => [accountId, roundCurrency(balance)])),
    requestedPostingAmountsById: Object.fromEntries(
      Object.entries(row.requestedPostingAmountsById).map(([postingId, amount]) => [postingId, roundCurrency(amount)])
    ),
    realizedPostingAmountsById: Object.fromEntries(
      Object.entries(row.realizedPostingAmountsById).map(([postingId, amount]) => [postingId, roundCurrency(amount)])
    ),
  };
}

export function projectCsvScenarioPack(
  pack: CsvScenarioPack,
  projectionSettings: ProjectionRuntimeSettings,
  whatIfState?: CsvScenarioWhatIfState,
  stochasticRates?: Map<string, number[]>
): CsvProjectionResult {
  const normalizedWhatIfState: CsvScenarioWhatIfState = whatIfState ?? { postingOverrides: {} };
  const normalizedCheckpoints = normalizeCheckpoints(pack);
  const projectionStartDate = normalizedCheckpoints.latestCheckpointDate ?? projectionSettings.fallbackProjectionStartDate;
  const projectionEndDate = addYearsClamped(projectionStartDate, projectionSettings.horizonYears);
  const includeStartDateEvents = normalizedCheckpoints.latestCheckpointDate === null;
  const accountById = new Map(pack.accounts.map((account) => [account.id, account]));
  const rows: CsvProjectionRow[] = [];
  const balances = initAccountBalances(pack.accounts);
  const futureStartingBalances = initAccountBalances(pack.accounts);
  const latestRealizedPostingAmountById = new Map<string, number>();
  const realizedPostingAmountByIdAndYear = new Map<string, number>();
  const requestedPostingTotalsById = new Map(pack.postings.map((posting) => [posting.id, 0]));
  const realizedPostingTotalsById = new Map(pack.postings.map((posting) => [posting.id, 0]));
  const firstShortfallDateById = new Map<string, IsoDate>();
  let totalExternalInflowAmount = 0;
  let totalExternalOutflowAmount = 0;
  let totalInternalTransferAmount = 0;
  let totalRequestedPostingAmount = 0;
  let totalRealizedPostingAmount = 0;
  let totalClampedPostingShortfallAmount = 0;
  let totalGrowthNetWorthImpact = 0;

  normalizedCheckpoints.dates.forEach(({ date, checkpoints }) => {
    checkpoints.forEach((checkpoint) => {
      balances[checkpoint.AccountId] = checkpoint.Balance;
    });

    rows.push(
      createRow({
        date,
        isHistorical: true,
        balances,
        accounts: pack.accounts,
        externalInflowAmount: 0,
        externalOutflowAmount: 0,
        internalTransferAmount: 0,
        requestedPostingAmount: 0,
        realizedPostingAmount: 0,
        clampedPostingShortfallAmount: 0,
        growthNetWorthImpact: 0,
        requestedPostingAmountsById: {},
        realizedPostingAmountsById: {},
      })
    );
  });

  Object.assign(futureStartingBalances, balances);

  const eventDates = new Map<IsoDate, DatedPostingOccurrence[]>();
  addMonthlyOccurrences(pack.postings, eventDates, projectionStartDate, projectionEndDate, includeStartDateEvents);

  const sortedProjectedDates = Array.from(eventDates.keys()).sort(compareIsoDates);
  let previousProjectedDate = projectionStartDate;

  sortedProjectedDates.forEach((date) => {
    const occurrences = eventDates.get(date);
    if (!occurrences) {
      return;
    }

    const growthNetWorthImpact = applyGrowth(
      balances,
      pack.accounts,
      daysBetween(previousProjectedDate, date),
      previousProjectedDate,
      projectionStartDate,
      stochasticRates
    );
    totalGrowthNetWorthImpact += growthNetWorthImpact;
    previousProjectedDate = date;

    const requestedPostingAmountsById: Record<string, number> = {};
    const realizedPostingAmountsById: Record<string, number> = {};
    let externalInflowAmount = 0;
    let externalOutflowAmount = 0;
    let internalTransferAmount = 0;
    let requestedPostingAmount = 0;
    let realizedPostingAmount = 0;
    let clampedPostingShortfallAmount = 0;

    const sortedOccurrences = [...occurrences].sort(
      (left, right) => left.posting.priority - right.posting.priority || left.index - right.index
    );

    sortedOccurrences.forEach((occurrence) => {
      const { posting } = occurrence;
      const requestedAmount = Math.max(0, computeRequestedAmount(occurrence, latestRealizedPostingAmountById, balances, normalizedWhatIfState));
      const capKey = `${posting.id}:${date.slice(0, 4)}`;
      const annualCapRemaining = posting.annualCap === null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, posting.annualCap - (realizedPostingAmountByIdAndYear.get(capKey) ?? 0));
      const realizedAmount = resolvePostingAmount(posting, requestedAmount, annualCapRemaining, balances, accountById);
      const shortfallAmount = requestedAmount - realizedAmount;

      if (shortfallAmount > 0 && !firstShortfallDateById.has(posting.id)) {
        firstShortfallDateById.set(posting.id, date);
      }

      requestedPostingAmountsById[posting.id] = requestedAmount;
      realizedPostingAmountsById[posting.id] = realizedAmount;
      requestedPostingAmount += requestedAmount;
      realizedPostingAmount += realizedAmount;
      clampedPostingShortfallAmount += shortfallAmount;
      totalRequestedPostingAmount += requestedAmount;
      totalRealizedPostingAmount += realizedAmount;
      totalClampedPostingShortfallAmount += shortfallAmount;
      requestedPostingTotalsById.set(posting.id, (requestedPostingTotalsById.get(posting.id) ?? 0) + requestedAmount);
      realizedPostingTotalsById.set(posting.id, (realizedPostingTotalsById.get(posting.id) ?? 0) + realizedAmount);
      realizedPostingAmountByIdAndYear.set(capKey, (realizedPostingAmountByIdAndYear.get(capKey) ?? 0) + realizedAmount);

      applyPosting(posting, realizedAmount, balances, accountById);
      latestRealizedPostingAmountById.set(posting.id, realizedAmount);

      if (posting.sourceAccountId === null && posting.destinations !== null) {
        externalInflowAmount += realizedAmount;
        totalExternalInflowAmount += realizedAmount;
        return;
      }

      if (posting.sourceAccountId !== null && posting.destinations === null) {
        externalOutflowAmount += realizedAmount;
        totalExternalOutflowAmount += realizedAmount;
        return;
      }

      if (posting.sourceAccountId !== null && posting.destinations !== null) {
        internalTransferAmount += realizedAmount;
        totalInternalTransferAmount += realizedAmount;
      }
    });

    rows.push(
      createRow({
        date,
        isHistorical: false,
        balances,
        accounts: pack.accounts,
        externalInflowAmount,
        externalOutflowAmount,
        internalTransferAmount,
        requestedPostingAmount,
        realizedPostingAmount,
        clampedPostingShortfallAmount,
        growthNetWorthImpact,
        requestedPostingAmountsById,
        realizedPostingAmountsById,
      })
    );
  });

  const sampledRows = rows;
  const latestHistoricalRow = [...rows].reverse().find((row) => row.isHistorical) ?? null;
  const latestRow = rows[rows.length - 1] ?? null;
  const currentNetWorth = latestHistoricalRow?.netWorth ?? computeNetWorth(futureStartingBalances, pack.accounts);
  const hitTargetRow = rows.find((row) => !row.isHistorical && row.netWorth >= projectionSettings.targetNetWorth) ?? null;

  const accountSummaries: CsvProjectionAccountSummary[] = pack.accounts.map((account) => {
    const endingBalance = latestRow?.accountBalances[account.id] ?? futureStartingBalances[account.id] ?? account.openingBalance;
    const startingBalance = futureStartingBalances[account.id] ?? account.openingBalance;

    return {
      accountId: account.id,
      label: account.label,
      color: account.color,
      annualRate: account.annualRate,
      enabled: account.enabled,
      openingBalance: roundCurrency(account.openingBalance),
      startingBalance: roundCurrency(startingBalance),
      endingBalance: roundCurrency(endingBalance),
    };
  });

  const postingSummaries: CsvProjectionPostingSummary[] = pack.postings.map((posting) => {
    const requestedAmount = requestedPostingTotalsById.get(posting.id) ?? 0;
    const realizedAmount = realizedPostingTotalsById.get(posting.id) ?? 0;

    return {
      postingId: posting.id,
      label: posting.label,
      sourceAccountId: posting.sourceAccountId,
      sourceAccountLabel: posting.sourceAccountId ? accountById.get(posting.sourceAccountId)?.label ?? posting.sourceAccountId : null,
      destinations: posting.destinations
        ? posting.destinations.map((destId) => ({
            accountId: destId,
            label: accountById.get(destId)?.label ?? destId,
          }))
        : null,
      priority: posting.priority,
      annualCap: posting.annualCap,
      requestedAmount: roundCurrency(requestedAmount),
      realizedAmount: roundCurrency(realizedAmount),
      utilizationRate: requestedAmount > 0 ? realizedAmount / requestedAmount : 0,
      firstShortfallDate: firstShortfallDateById.get(posting.id) ?? null,
      shortfallAmount: roundCurrency(requestedAmount - realizedAmount),
    };
  });

  return {
    timeline: {
      rows: rows.map(roundRow),
      sampledRows: sampledRows.map(roundRow),
    },
    accountSummaries,
    postingSummaries,
    totals: {
      externalInflowAmount: roundCurrency(totalExternalInflowAmount),
      externalOutflowAmount: roundCurrency(totalExternalOutflowAmount),
      internalTransferAmount: roundCurrency(totalInternalTransferAmount),
      requestedPostingAmount: roundCurrency(totalRequestedPostingAmount),
      realizedPostingAmount: roundCurrency(totalRealizedPostingAmount),
      clampedPostingShortfallAmount: roundCurrency(totalClampedPostingShortfallAmount),
      growthNetWorthImpact: roundCurrency(totalGrowthNetWorthImpact),
    },
    milestones: {
      hitTargetDate: hitTargetRow?.date ?? null,
      latestCheckpointDate: normalizedCheckpoints.latestCheckpointDate,
      latestHistoricalDate: latestHistoricalRow?.date ?? null,
      projectionStartDate,
    },
    summary: {
      currentNetWorth: roundCurrency(currentNetWorth),
      finalNetWorth: roundCurrency(latestRow?.netWorth ?? currentNetWorth),
    },
  };
}
