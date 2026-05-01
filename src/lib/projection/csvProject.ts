import type {
  CsvAccount,
  CsvBudgetItem,
  CsvContributionPlan,
  CsvProjectionAccountSummary,
  CsvProjectionContributionSummary,
  CsvProjectionResult,
  CsvProjectionRow,
  CsvScenarioPack,
  CsvScenarioWhatIfState,
  CsvTransfer,
  IsoDate,
  ProjectionRuntimeSettings,
} from "./csvTypes";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 365;

interface DatedBudgetItemOccurrence {
  budgetItem: CsvBudgetItem;
  monthsElapsed: number;
}

interface DatedEventGroup {
  budgetItems: DatedBudgetItemOccurrence[];
  contributionPlans: CsvContributionPlan[];
  transfers: CsvTransfer[];
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

function getCalendarMonthDifference(startDate: IsoDate, endDate: IsoDate): number {
  const start = parseIsoDate(startDate);
  const end = parseIsoDate(endDate);
  return (end.getUTCFullYear() - start.getUTCFullYear()) * 12 + (end.getUTCMonth() - start.getUTCMonth());
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

function addMonthlyOccurrences<T extends { enabled: boolean; startDate: IsoDate; endDate: IsoDate | null }>(
  items: T[],
  eventDates: Map<IsoDate, DatedEventGroup>,
  projectionStartDate: IsoDate,
  projectionEndDate: IsoDate,
  includeStartDate: boolean,
  assign: (group: DatedEventGroup, item: T, monthsElapsed: number) => void
): void {
  items.forEach((item) => {
    if (!item.enabled) {
      return;
    }

    const effectiveEndDate = item.endDate !== null && compareIsoDates(item.endDate, projectionEndDate) < 0 ? item.endDate : projectionEndDate;

    for (let monthsElapsed = 0; ; monthsElapsed += 1) {
      const occurrenceDate = addMonthsClamped(item.startDate, monthsElapsed);
      if (compareIsoDates(occurrenceDate, effectiveEndDate) > 0) {
        break;
      }

      const startsInWindow = includeStartDate
        ? compareIsoDates(occurrenceDate, projectionStartDate) >= 0
        : compareIsoDates(occurrenceDate, projectionStartDate) > 0;

      if (!startsInWindow) {
        continue;
      }

      const group = eventDates.get(occurrenceDate) ?? { budgetItems: [], contributionPlans: [], transfers: [] };
      assign(group, item, monthsElapsed);
      eventDates.set(occurrenceDate, group);
    }
  });
}

function buildBudgetItemAmountsForDate(
  occurrences: DatedBudgetItemOccurrence[],
  latestBudgetItemAmountById: Map<string, number>
): Record<string, number> {
  const occurrenceById = new Map(occurrences.map((occurrence) => [occurrence.budgetItem.id, occurrence]));
  const memo = new Map<string, number>();
  const resolving = new Set<string>();

  const resolveAmount = (budgetItemId: string): number => {
    const cached = memo.get(budgetItemId);
    if (cached !== undefined) {
      return cached;
    }

    const occurrence = occurrenceById.get(budgetItemId);
    if (!occurrence) {
      const latestAmount = latestBudgetItemAmountById.get(budgetItemId) ?? 0;
      memo.set(budgetItemId, latestAmount);
      return latestAmount;
    }

    if (resolving.has(budgetItemId)) {
      memo.set(budgetItemId, 0);
      return 0;
    }

    resolving.add(budgetItemId);

    const { budgetItem, monthsElapsed } = occurrence;
    const baseAmount = budgetItem.amountMode === "fixed"
      ? budgetItem.amount
      : budgetItem.parentBudgetItemId
        ? resolveAmount(budgetItem.parentBudgetItemId) * budgetItem.amount
        : 0;
    const resolvedAmount = applyAnnualGrowth(baseAmount, budgetItem.annualGrowthRate, monthsElapsed);

    resolving.delete(budgetItemId);
    memo.set(budgetItemId, resolvedAmount);
    return resolvedAmount;
  };

  occurrences.forEach((occurrence) => {
    resolveAmount(occurrence.budgetItem.id);
  });

  return Object.fromEntries(memo.entries());
}

function getContributionRequestedAmount(
  contributionPlan: CsvContributionPlan,
  availableContributionCapacity: number,
  latestBudgetItemAmountById: Map<string, number>,
  whatIfState: CsvScenarioWhatIfState
): number {
  const override = whatIfState.contributionPlanOverrides[contributionPlan.id];

  if (override?.mode === "amount") {
    return Math.max(0, override.value);
  }

  const multiplier = override?.mode === "multiplier" ? Math.max(0, override.value) : 1;

  if (contributionPlan.calculationMode === "fixed") {
    return contributionPlan.amount * multiplier;
  }

  if (contributionPlan.calculationMode === "percent_of_capacity") {
    return Math.max(0, availableContributionCapacity) * contributionPlan.amount * multiplier;
  }

  if (!contributionPlan.baseBudgetItemId) {
    return 0;
  }

  return (latestBudgetItemAmountById.get(contributionPlan.baseBudgetItemId) ?? 0) * contributionPlan.amount * multiplier;
}

function applyContributionToBalance(account: CsvAccount, balances: Record<string, number>, amount: number): void {
  balances[account.id] = (balances[account.id] ?? 0) + amount;
}

function resolveTransferAmount(
  transfer: CsvTransfer,
  balances: Record<string, number>,
  accountById: Map<string, CsvAccount>
): number {
  const sourceAccount = accountById.get(transfer.sourceAccountId);
  const destinationAccount = accountById.get(transfer.destinationAccountId);

  if (!sourceAccount || !destinationAccount) {
    return 0;
  }

  return Math.max(0, Math.min(transfer.amount, Math.max(0, balances[sourceAccount.id] ?? 0)));
}

function applyTransfer(
  transfer: CsvTransfer,
  realizedAmount: number,
  balances: Record<string, number>,
  accountById: Map<string, CsvAccount>
): void {
  const sourceAccount = accountById.get(transfer.sourceAccountId);
  const destinationAccount = accountById.get(transfer.destinationAccountId);

  if (!sourceAccount || !destinationAccount || realizedAmount <= 0) {
    return;
  }

  balances[sourceAccount.id] = (balances[sourceAccount.id] ?? 0) - realizedAmount;
  balances[destinationAccount.id] = (balances[destinationAccount.id] ?? 0) + realizedAmount;
}

function createRow({
  date,
  isHistorical,
  balances,
  accounts,
  availableContributionCapacity,
  budgetCashflowAmount,
  requestedContributionAmount,
  realizedContributionAmount,
  transferAmount,
  growthNetWorthImpact,
  requestedContributionAmountsByPlanId,
  realizedContributionAmountsByPlanId,
}: {
  date: IsoDate;
  isHistorical: boolean;
  balances: Record<string, number>;
  accounts: CsvAccount[];
  availableContributionCapacity: number;
  budgetCashflowAmount: number;
  requestedContributionAmount: number;
  realizedContributionAmount: number;
  transferAmount: number;
  growthNetWorthImpact: number;
  requestedContributionAmountsByPlanId: Record<string, number>;
  realizedContributionAmountsByPlanId: Record<string, number>;
}): CsvProjectionRow {
  return {
    date,
    isHistorical,
    netWorth: computeNetWorth(balances, accounts),
    accountBalances: { ...balances },
    availableContributionCapacity,
    budgetCashflowAmount,
    requestedContributionAmount,
    realizedContributionAmount,
    transferAmount,
    growthNetWorthImpact,
    requestedContributionAmountsByPlanId,
    realizedContributionAmountsByPlanId,
  };
}

function roundRow(row: CsvProjectionRow): CsvProjectionRow {
  return {
    ...row,
    netWorth: roundCurrency(row.netWorth),
    availableContributionCapacity: roundCurrency(row.availableContributionCapacity),
    budgetCashflowAmount: roundCurrency(row.budgetCashflowAmount),
    requestedContributionAmount: roundCurrency(row.requestedContributionAmount),
    realizedContributionAmount: roundCurrency(row.realizedContributionAmount),
    transferAmount: roundCurrency(row.transferAmount),
    growthNetWorthImpact: roundCurrency(row.growthNetWorthImpact),
    accountBalances: Object.fromEntries(Object.entries(row.accountBalances).map(([accountId, balance]) => [accountId, roundCurrency(balance)])),
    requestedContributionAmountsByPlanId: Object.fromEntries(
      Object.entries(row.requestedContributionAmountsByPlanId).map(([planId, amount]) => [planId, roundCurrency(amount)])
    ),
    realizedContributionAmountsByPlanId: Object.fromEntries(
      Object.entries(row.realizedContributionAmountsByPlanId).map(([planId, amount]) => [planId, roundCurrency(amount)])
    ),
  };
}

export function projectCsvScenarioPack(
  pack: CsvScenarioPack,
  projectionSettings: ProjectionRuntimeSettings,
  whatIfState?: CsvScenarioWhatIfState
): CsvProjectionResult {
  const normalizedWhatIfState: CsvScenarioWhatIfState = whatIfState ?? { contributionPlanOverrides: {} };
  const normalizedCheckpoints = normalizeCheckpoints(pack);
  const projectionStartDate = normalizedCheckpoints.latestCheckpointDate ?? projectionSettings.fallbackProjectionStartDate;
  const projectionEndDate = addYearsClamped(projectionStartDate, projectionSettings.horizonYears);
  const includeStartDateEvents = normalizedCheckpoints.latestCheckpointDate === null;
  const accountById = new Map(pack.accounts.map((account) => [account.id, account]));
  const rows: CsvProjectionRow[] = [];
  const balances = createBaseBalances(pack.accounts);
  const futureStartingBalances = createBaseBalances(pack.accounts);
  const latestBudgetItemAmountById = new Map<string, number>();
  const realizedContributionAmountByPlanAndYear = new Map<string, number>();
  const requestedContributionTotalsByPlanId = new Map(pack.contributionPlans.map((plan) => [plan.id, 0]));
  const realizedContributionTotalsByPlanId = new Map(pack.contributionPlans.map((plan) => [plan.id, 0]));
  let availableContributionCapacity = 0;
  let totalBudgetCashflowAmount = 0;
  let totalRequestedContributions = 0;
  let totalRealizedContributions = 0;
  let totalTransferAmount = 0;
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
        availableContributionCapacity,
        budgetCashflowAmount: 0,
        requestedContributionAmount: 0,
        realizedContributionAmount: 0,
        transferAmount: 0,
        growthNetWorthImpact: 0,
        requestedContributionAmountsByPlanId: {},
        realizedContributionAmountsByPlanId: {},
      })
    );
  });

  Object.assign(futureStartingBalances, balances);

  const eventDates = new Map<IsoDate, DatedEventGroup>();

  addMonthlyOccurrences(pack.budgetItems, eventDates, projectionStartDate, projectionEndDate, includeStartDateEvents, (group, budgetItem, monthsElapsed) => {
    group.budgetItems.push({ budgetItem, monthsElapsed });
  });
  addMonthlyOccurrences(pack.contributionPlans, eventDates, projectionStartDate, projectionEndDate, includeStartDateEvents, (group, contributionPlan) => {
    group.contributionPlans.push(contributionPlan);
  });
  addMonthlyOccurrences(pack.transfers, eventDates, projectionStartDate, projectionEndDate, includeStartDateEvents, (group, transfer) => {
    group.transfers.push(transfer);
  });

  const sortedProjectedDates = Array.from(eventDates.keys()).sort(compareIsoDates);
  const sortedContributionPlans = pack.contributionPlans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => plan.enabled)
    .sort((left, right) => left.plan.priority - right.plan.priority || left.index - right.index)
    .map(({ plan }) => plan);
  let previousProjectedDate = projectionStartDate;

  sortedProjectedDates.forEach((date) => {
    const events = eventDates.get(date);
    if (!events) {
      return;
    }

    const growthNetWorthImpact = applyGrowthBetweenDates(balances, pack.accounts, previousProjectedDate, date);
    totalGrowthNetWorthImpact += growthNetWorthImpact;
    previousProjectedDate = date;

    const budgetItemAmountsById = buildBudgetItemAmountsForDate(events.budgetItems, latestBudgetItemAmountById);
    let budgetCashflowAmount = 0;

    events.budgetItems.forEach(({ budgetItem }) => {
      const amount = budgetItemAmountsById[budgetItem.id] ?? 0;
      latestBudgetItemAmountById.set(budgetItem.id, amount);
      budgetCashflowAmount += budgetItem.direction === "in" ? amount : -amount;
    });

    availableContributionCapacity += budgetCashflowAmount;
    totalBudgetCashflowAmount += budgetCashflowAmount;

    const eventsContributionPlanIds = new Set(events.contributionPlans.map((plan) => plan.id));
    const requestedContributionAmountsByPlanId: Record<string, number> = {};
    const realizedContributionAmountsByPlanId: Record<string, number> = {};
    let requestedContributionAmount = 0;
    let realizedContributionAmount = 0;

    sortedContributionPlans.forEach((contributionPlan) => {
      if (!eventsContributionPlanIds.has(contributionPlan.id)) {
        return;
      }

      const requestedAmount = Math.max(
        0,
        getContributionRequestedAmount(contributionPlan, availableContributionCapacity, latestBudgetItemAmountById, normalizedWhatIfState)
      );
      const targetAccount = accountById.get(contributionPlan.targetAccountId);
      const capKey = `${contributionPlan.id}:${date.slice(0, 4)}`;
      const annualCapRemaining = contributionPlan.annualCap === null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, contributionPlan.annualCap - (realizedContributionAmountByPlanAndYear.get(capKey) ?? 0));
      const realizedAmount = targetAccount
        ? Math.max(0, Math.min(requestedAmount, Math.max(0, availableContributionCapacity), annualCapRemaining))
        : 0;

      requestedContributionAmountsByPlanId[contributionPlan.id] = requestedAmount;
      realizedContributionAmountsByPlanId[contributionPlan.id] = realizedAmount;
      requestedContributionAmount += requestedAmount;
      realizedContributionAmount += realizedAmount;
      totalRequestedContributions += requestedAmount;
      totalRealizedContributions += realizedAmount;
      requestedContributionTotalsByPlanId.set(contributionPlan.id, (requestedContributionTotalsByPlanId.get(contributionPlan.id) ?? 0) + requestedAmount);
      realizedContributionTotalsByPlanId.set(contributionPlan.id, (realizedContributionTotalsByPlanId.get(contributionPlan.id) ?? 0) + realizedAmount);
      realizedContributionAmountByPlanAndYear.set(capKey, (realizedContributionAmountByPlanAndYear.get(capKey) ?? 0) + realizedAmount);

      availableContributionCapacity -= realizedAmount;

      if (targetAccount && realizedAmount > 0) {
        applyContributionToBalance(targetAccount, balances, realizedAmount);
      }
    });

    let transferAmount = 0;

    events.transfers.forEach((transfer) => {
      const realizedAmount = resolveTransferAmount(transfer, balances, accountById);
      if (realizedAmount <= 0) {
        return;
      }

      applyTransfer(transfer, realizedAmount, balances, accountById);
      transferAmount += realizedAmount;
      totalTransferAmount += realizedAmount;
    });

    rows.push(
      createRow({
        date,
        isHistorical: false,
        balances,
        accounts: pack.accounts,
        availableContributionCapacity,
        budgetCashflowAmount,
        requestedContributionAmount,
        realizedContributionAmount,
        transferAmount,
        growthNetWorthImpact,
        requestedContributionAmountsByPlanId,
        realizedContributionAmountsByPlanId,
      })
    );
  });

  const sampledRows = rows;
  const latestHistoricalRow = [...rows].reverse().find((row) => row.isHistorical) ?? null;
  const latestProjectedRow = [...rows].reverse().find((row) => !row.isHistorical) ?? null;
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

  const contributionSummaries: CsvProjectionContributionSummary[] = pack.contributionPlans.map((contributionPlan) => {
    const requestedAmount = requestedContributionTotalsByPlanId.get(contributionPlan.id) ?? 0;
    const realizedAmount = realizedContributionTotalsByPlanId.get(contributionPlan.id) ?? 0;

    return {
      contributionPlanId: contributionPlan.id,
      label: contributionPlan.label,
      targetAccountId: contributionPlan.targetAccountId,
      targetAccountLabel: accountById.get(contributionPlan.targetAccountId)?.label ?? contributionPlan.targetAccountId,
      priority: contributionPlan.priority,
      annualCap: contributionPlan.annualCap,
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
    contributionSummaries,
    totals: {
      budgetCashflowAmount: roundCurrency(totalBudgetCashflowAmount),
      requestedContributions: roundCurrency(totalRequestedContributions),
      realizedContributions: roundCurrency(totalRealizedContributions),
      transferAmount: roundCurrency(totalTransferAmount),
      growthNetWorthImpact: roundCurrency(totalGrowthNetWorthImpact),
      latestAvailableContributionCapacity: latestProjectedRow ? roundCurrency(latestProjectedRow.availableContributionCapacity) : 0,
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
