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
} from "./csvTypes";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 365;

interface DatedPostingOccurrence {
  posting: CsvPosting;
  monthsElapsed: number;
  index: number;
}

interface NormalizedCheckpoints {
  dates: Array<{
    date: IsoDate;
    checkpoints: CsvScenarioPack["checkpoints"];
  }>;
  earliestCheckpointDate: IsoDate | null;
  latestCheckpointDate: IsoDate | null;
}

function parseIsoDate(value: IsoDate): Date {
  return new Date(`${value}T00:00:00Z`);
}

function formatIsoDate(date: Date): IsoDate {
  return date.toISOString().slice(0, 10);
}

function compareIsoDates(left: IsoDate, right: IsoDate): number {
  return parseIsoDate(left).getTime() - parseIsoDate(right).getTime();
}

function daysBetween(left: IsoDate, right: IsoDate): number {
  return Math.round((parseIsoDate(right).getTime() - parseIsoDate(left).getTime()) / MS_PER_DAY);
}

function getDaysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function addMonthsClamped(date: IsoDate, monthsToAdd: number): IsoDate {
  const source = parseIsoDate(date);
  const year = source.getUTCFullYear();
  const month = source.getUTCMonth();
  const day = source.getUTCDate();
  const nextMonthIndex = month + monthsToAdd;
  const targetYear = year + Math.floor(nextMonthIndex / 12);
  const targetMonth = ((nextMonthIndex % 12) + 12) % 12;
  const targetDay = Math.min(day, getDaysInMonth(targetYear, targetMonth + 1));

  return formatIsoDate(new Date(Date.UTC(targetYear, targetMonth, targetDay)));
}

function addYearsClamped(date: IsoDate, yearsToAdd: number): IsoDate {
  return addMonthsClamped(date, yearsToAdd * 12);
}

function roundCurrency(value: number): number {
  return Math.round(value);
}

function computeNetWorth(balances: Record<string, number>, accounts: CsvAccount[]): number {
  return accounts.reduce((total, account) => {
    if (!account.enabled) {
      return total;
    }

    return total + (balances[account.id] ?? 0);
  }, 0);
}

function createBaseBalances(accounts: CsvAccount[]): Record<string, number> {
  return Object.fromEntries(accounts.map((account) => [account.id, account.openingBalance]));
}

function applyAnnualGrowth(amount: number, annualGrowthRate: number, monthsElapsed: number): number {
  if (amount === 0 || annualGrowthRate === 0 || monthsElapsed <= 0) {
    return amount;
  }

  return amount * Math.pow(1 + annualGrowthRate, monthsElapsed / 12);
}

function applyGrowthBetweenDates(balances: Record<string, number>, accounts: CsvAccount[], previousDate: IsoDate, nextDate: IsoDate): number {
  const daysElapsed = daysBetween(previousDate, nextDate);

  if (daysElapsed <= 0) {
    return 0;
  }

  let growthNetWorthImpact = 0;

  accounts.forEach((account) => {
    const currentBalance = balances[account.id] ?? 0;
    if (currentBalance === 0 || account.annualRate === 0) {
      return;
    }

    const growthAmount = currentBalance * (Math.pow(1 + account.annualRate, daysElapsed / DAYS_PER_YEAR) - 1);
    balances[account.id] = currentBalance + growthAmount;
    growthNetWorthImpact += growthAmount;
  });

  return growthNetWorthImpact;
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

function addMonthlyOccurrences(
  postings: CsvPosting[],
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

function getPostingRequestedAmount(
  occurrence: DatedPostingOccurrence,
  latestRealizedPostingAmountById: Map<string, number>,
  whatIfState: CsvScenarioWhatIfState
): number {
  const { posting, monthsElapsed } = occurrence;
  const override = whatIfState.postingOverrides[posting.id];

  if (override?.mode === "amount") {
    return Math.max(0, override.value);
  }

  const multiplier = override?.mode === "multiplier" ? Math.max(0, override.value) : 1;
  const baseAmount = posting.amountMode === "fixed"
    ? posting.amount
    : posting.basePostingId
      ? (latestRealizedPostingAmountById.get(posting.basePostingId) ?? 0) * posting.amount
      : 0;

  return applyAnnualGrowth(baseAmount, posting.annualGrowthRate, monthsElapsed) * multiplier;
}

function resolvePostingAmount(
  posting: CsvPosting,
  requestedAmount: number,
  annualCapRemaining: number,
  balances: Record<string, number>,
  accountById: Map<string, CsvAccount>
): number {
  if (requestedAmount <= 0) {
    return 0;
  }

  if (posting.sourceAccountId !== null && !accountById.has(posting.sourceAccountId)) {
    return 0;
  }

  if (posting.destinationAccountId !== null && !accountById.has(posting.destinationAccountId)) {
    return 0;
  }

  const sourceBalanceLimit = posting.sourceAccountId === null
    ? Number.POSITIVE_INFINITY
    : Math.max(0, balances[posting.sourceAccountId] ?? 0);

  return Math.max(0, Math.min(requestedAmount, annualCapRemaining, sourceBalanceLimit));
}

function applyPosting(
  posting: CsvPosting,
  realizedAmount: number,
  balances: Record<string, number>
): void {
  if (realizedAmount <= 0) {
    return;
  }

  if (posting.sourceAccountId !== null) {
    balances[posting.sourceAccountId] = (balances[posting.sourceAccountId] ?? 0) - realizedAmount;
  }

  if (posting.destinationAccountId !== null) {
    balances[posting.destinationAccountId] = (balances[posting.destinationAccountId] ?? 0) + realizedAmount;
  }
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
  whatIfState?: CsvScenarioWhatIfState
): CsvProjectionResult {
  const normalizedWhatIfState: CsvScenarioWhatIfState = whatIfState ?? { postingOverrides: {} };
  const normalizedCheckpoints = normalizeCheckpoints(pack);
  const projectionStartDate = normalizedCheckpoints.latestCheckpointDate ?? projectionSettings.fallbackProjectionStartDate;
  const projectionEndDate = addYearsClamped(projectionStartDate, projectionSettings.horizonYears);
  const includeStartDateEvents = normalizedCheckpoints.latestCheckpointDate === null;
  const accountById = new Map(pack.accounts.map((account) => [account.id, account]));
  const rows: CsvProjectionRow[] = [];
  const balances = createBaseBalances(pack.accounts);
  const futureStartingBalances = createBaseBalances(pack.accounts);
  const latestRealizedPostingAmountById = new Map<string, number>();
  const realizedPostingAmountByIdAndYear = new Map<string, number>();
  const requestedPostingTotalsById = new Map(pack.postings.map((posting) => [posting.id, 0]));
  const realizedPostingTotalsById = new Map(pack.postings.map((posting) => [posting.id, 0]));
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

    const growthNetWorthImpact = applyGrowthBetweenDates(balances, pack.accounts, previousProjectedDate, date);
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
      const requestedAmount = Math.max(0, getPostingRequestedAmount(occurrence, latestRealizedPostingAmountById, normalizedWhatIfState));
      const capKey = `${posting.id}:${date.slice(0, 4)}`;
      const annualCapRemaining = posting.annualCap === null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, posting.annualCap - (realizedPostingAmountByIdAndYear.get(capKey) ?? 0));
      const realizedAmount = resolvePostingAmount(posting, requestedAmount, annualCapRemaining, balances, accountById);
      const shortfallAmount = requestedAmount - realizedAmount;

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

      applyPosting(posting, realizedAmount, balances);
      latestRealizedPostingAmountById.set(posting.id, realizedAmount);

      if (posting.sourceAccountId === null && posting.destinationAccountId !== null) {
        externalInflowAmount += realizedAmount;
        totalExternalInflowAmount += realizedAmount;
        return;
      }

      if (posting.sourceAccountId !== null && posting.destinationAccountId === null) {
        externalOutflowAmount += realizedAmount;
        totalExternalOutflowAmount += realizedAmount;
        return;
      }

      if (posting.sourceAccountId !== null && posting.destinationAccountId !== null) {
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
      destinationAccountId: posting.destinationAccountId,
      destinationAccountLabel: posting.destinationAccountId
        ? accountById.get(posting.destinationAccountId)?.label ?? posting.destinationAccountId
        : null,
      priority: posting.priority,
      annualCap: posting.annualCap,
      requestedAmount: roundCurrency(requestedAmount),
      realizedAmount: roundCurrency(realizedAmount),
      utilizationRate: requestedAmount > 0 ? realizedAmount / requestedAmount : 0,
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
