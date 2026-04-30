import type {
  CsvAccount,
  CsvBudgetItem,
  CsvContributionPlan,
  CsvProjectionAccountSummary,
  CsvProjectionContributionSummary,
  CsvProjectionResult,
  CsvProjectionRow,
  CsvScenarioPack,
  CsvTransfer,
  MonthLabel,
} from "./csvTypes";

interface NormalizedCheckpoints {
  balancesByMonth: Map<number, Record<string, number>>;
  earliestHistoricalMonthIndex: number | null;
  latestCheckpointDate: string | null;
  latestCheckpointMonthLabel: MonthLabel | null;
}

function toMonthIndex(year: number, month: number): number {
  return year * 12 + (month - 1);
}

export function parseMonthLabelToIndex(monthLabel: MonthLabel): number {
  const [year, month] = monthLabel.split("-").map(Number);
  return toMonthIndex(year, month);
}

export function formatMonthIndex(monthIndex: number): MonthLabel {
  const year = Math.floor(monthIndex / 12);
  const month = (monthIndex % 12) + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseCheckpointDate(value: string) {
  const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})/u);

  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    const isoDate = `${match[1]}-${match[2]}-${match[3]}`;

    return {
      year,
      month,
      isoDate,
      timestamp: Date.parse(`${isoDate}T00:00:00Z`),
    };
  }

  const fallback = new Date(value);

  return {
    year: fallback.getUTCFullYear(),
    month: fallback.getUTCMonth() + 1,
    isoDate: fallback.toISOString().slice(0, 10),
    timestamp: fallback.getTime(),
  };
}

function roundCurrency(value: number): number {
  return Math.round(value);
}

function computeNetWorth(balances: Record<string, number>, accounts: CsvAccount[]): number {
  return accounts.reduce((total, account) => {
    if (!account.enabled) {
      return total;
    }

    const balance = balances[account.id] ?? 0;
    return total + (account.balanceType === "liability" ? -balance : balance);
  }, 0);
}

function createBaseBalances(accounts: CsvAccount[]): Record<string, number> {
  return Object.fromEntries(accounts.map((account) => [account.id, account.openingBalance]));
}

function normalizeCheckpoints(pack: CsvScenarioPack, projectionStartMonthIndex: number): NormalizedCheckpoints {
  const rawByMonth = new Map<number, Map<string, { balance: number; timestamp: number }>>();
  let earliestHistoricalMonthIndex: number | null = null;
  let latestCheckpointDate: string | null = null;
  let latestCheckpointMonthLabel: MonthLabel | null = null;
  let latestCheckpointTimestamp = Number.NEGATIVE_INFINITY;

  pack.checkpoints.forEach((checkpoint) => {
    const parsedDate = parseCheckpointDate(checkpoint.Date);
    const monthIndex = toMonthIndex(parsedDate.year, parsedDate.month);

    if (parsedDate.timestamp > latestCheckpointTimestamp) {
      latestCheckpointTimestamp = parsedDate.timestamp;
      latestCheckpointDate = parsedDate.isoDate;
      latestCheckpointMonthLabel = formatMonthIndex(monthIndex);
    }

    if (monthIndex < projectionStartMonthIndex) {
      earliestHistoricalMonthIndex = earliestHistoricalMonthIndex === null
        ? monthIndex
        : Math.min(earliestHistoricalMonthIndex, monthIndex);
    }

    if (!rawByMonth.has(monthIndex)) {
      rawByMonth.set(monthIndex, new Map());
    }

    const monthEntries = rawByMonth.get(monthIndex);
    const existing = monthEntries?.get(checkpoint.AccountId);

    if (!existing || parsedDate.timestamp >= existing.timestamp) {
      monthEntries?.set(checkpoint.AccountId, {
        balance: checkpoint.Balance,
        timestamp: parsedDate.timestamp,
      });
    }
  });

  return {
    balancesByMonth: new Map(
      Array.from(rawByMonth.entries()).map(([monthIndex, accountEntries]) => [
        monthIndex,
        Object.fromEntries(Array.from(accountEntries.entries()).map(([accountId, value]) => [accountId, value.balance])),
      ])
    ),
    earliestHistoricalMonthIndex,
    latestCheckpointDate,
    latestCheckpointMonthLabel,
  };
}

function isScheduled(monthIndex: number, startMonth: MonthLabel, endMonth: MonthLabel | null, frequencyMonths: number): boolean {
  const startMonthIndex = parseMonthLabelToIndex(startMonth);

  if (monthIndex < startMonthIndex) {
    return false;
  }

  if (endMonth !== null && monthIndex > parseMonthLabelToIndex(endMonth)) {
    return false;
  }

  return (monthIndex - startMonthIndex) % frequencyMonths === 0;
}

function applyAnnualGrowth(amount: number, annualGrowthRate: number, monthsElapsed: number): number {
  if (amount === 0 || annualGrowthRate === 0 || monthsElapsed <= 0) {
    return amount;
  }

  return amount * Math.pow(1 + annualGrowthRate, monthsElapsed / 12);
}

function buildBudgetItemAmountsById(budgetItems: CsvBudgetItem[], monthIndex: number): Record<string, number> {
  const budgetItemById = new Map(budgetItems.map((budgetItem) => [budgetItem.id, budgetItem]));
  const memo = new Map<string, number>();
  const resolving = new Set<string>();

  const resolveAmount = (budgetItemId: string): number => {
    const cached = memo.get(budgetItemId);
    if (cached !== undefined) {
      return cached;
    }

    const budgetItem = budgetItemById.get(budgetItemId);
    if (!budgetItem || !budgetItem.enabled || !isScheduled(monthIndex, budgetItem.startMonth, budgetItem.endMonth, budgetItem.frequencyMonths)) {
      memo.set(budgetItemId, 0);
      return 0;
    }

    if (resolving.has(budgetItemId)) {
      memo.set(budgetItemId, 0);
      return 0;
    }

    resolving.add(budgetItemId);

    const startMonthIndex = parseMonthLabelToIndex(budgetItem.startMonth);
    const monthsElapsed = monthIndex - startMonthIndex;
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

  budgetItems.forEach((budgetItem) => {
    resolveAmount(budgetItem.id);
  });

  return Object.fromEntries(memo.entries());
}

function calculateInvestableCapacity(budgetItems: CsvBudgetItem[], budgetItemAmountsById: Record<string, number>): number {
  return budgetItems.reduce((total, budgetItem) => {
    if (!budgetItem.enabled) {
      return total;
    }

    const amount = budgetItemAmountsById[budgetItem.id] ?? 0;
    return total + (budgetItem.direction === "in" ? amount : -amount);
  }, 0);
}

function getContributionRequestedAmount(
  contributionPlan: CsvContributionPlan,
  investableCapacity: number,
  budgetItemAmountsById: Record<string, number>
): number {
  if (contributionPlan.calculationMode === "fixed") {
    return contributionPlan.amount;
  }

  if (contributionPlan.calculationMode === "percent_of_capacity") {
    return Math.max(0, investableCapacity) * contributionPlan.amount;
  }

  if (!contributionPlan.baseBudgetItemId) {
    return 0;
  }

  return (budgetItemAmountsById[contributionPlan.baseBudgetItemId] ?? 0) * contributionPlan.amount;
}

function applyContributionToBalance(account: CsvAccount, balances: Record<string, number>, amount: number): void {
  if (account.balanceType === "liability") {
    balances[account.id] = Math.max(0, (balances[account.id] ?? 0) - amount);
    return;
  }

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

  let realizedAmount = transfer.amount;

  if (sourceAccount.balanceType === "asset") {
    realizedAmount = Math.min(realizedAmount, Math.max(0, balances[sourceAccount.id] ?? 0));
  }

  if (destinationAccount.balanceType === "liability") {
    realizedAmount = Math.min(realizedAmount, Math.max(0, balances[destinationAccount.id] ?? 0));
  }

  return Math.max(0, realizedAmount);
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

  balances[sourceAccount.id] = sourceAccount.balanceType === "liability"
    ? (balances[sourceAccount.id] ?? 0) + realizedAmount
    : Math.max(0, (balances[sourceAccount.id] ?? 0) - realizedAmount);

  balances[destinationAccount.id] = destinationAccount.balanceType === "liability"
    ? Math.max(0, (balances[destinationAccount.id] ?? 0) - realizedAmount)
    : (balances[destinationAccount.id] ?? 0) + realizedAmount;
}

function createRow({
  monthIndex,
  isHistorical,
  balances,
  accounts,
  investableCapacity,
  requestedContributionAmount,
  realizedContributionAmount,
  transferAmount,
  growthNetWorthImpact,
  requestedContributionAmountsByPlanId,
  realizedContributionAmountsByPlanId,
}: {
  monthIndex: number;
  isHistorical: boolean;
  balances: Record<string, number>;
  accounts: CsvAccount[];
  investableCapacity: number;
  requestedContributionAmount: number;
  realizedContributionAmount: number;
  transferAmount: number;
  growthNetWorthImpact: number;
  requestedContributionAmountsByPlanId: Record<string, number>;
  realizedContributionAmountsByPlanId: Record<string, number>;
}): CsvProjectionRow {
  return {
    monthIndex,
    monthLabel: formatMonthIndex(monthIndex),
    isHistorical,
    netWorth: computeNetWorth(balances, accounts),
    accountBalances: { ...balances },
    investableCapacity,
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
    investableCapacity: roundCurrency(row.investableCapacity),
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

export function projectCsvScenarioPack(pack: CsvScenarioPack): CsvProjectionResult {
  const projectionStartMonthIndex = parseMonthLabelToIndex(pack.scenario.startDate);
  const normalizedCheckpoints = normalizeCheckpoints(pack, projectionStartMonthIndex);
  const accountById = new Map(pack.accounts.map((account) => [account.id, account]));
  const monthlyRows: CsvProjectionRow[] = [];
  const balances = createBaseBalances(pack.accounts);
  const futureStartingBalances = createBaseBalances(pack.accounts);
  const realizedContributionAmountByPlanAndYear = new Map<string, number>();
  const requestedContributionTotalsByPlanId = new Map(pack.contributionPlans.map((plan) => [plan.id, 0]));
  const realizedContributionTotalsByPlanId = new Map(pack.contributionPlans.map((plan) => [plan.id, 0]));
  let totalRequestedContributions = 0;
  let totalRealizedContributions = 0;
  let totalTransferAmount = 0;
  let totalGrowthNetWorthImpact = 0;
  let totalProjectedInvestableCapacity = 0;
  let projectedMonthCount = 0;

  if (normalizedCheckpoints.earliestHistoricalMonthIndex !== null) {
    for (let monthIndex = normalizedCheckpoints.earliestHistoricalMonthIndex; monthIndex < projectionStartMonthIndex; monthIndex += 1) {
      const checkpointBalances = normalizedCheckpoints.balancesByMonth.get(monthIndex);

      if (checkpointBalances) {
        Object.entries(checkpointBalances).forEach(([accountId, balance]) => {
          balances[accountId] = balance;
        });
      }

      monthlyRows.push(
        createRow({
          monthIndex,
          isHistorical: true,
          balances,
          accounts: pack.accounts,
          investableCapacity: 0,
          requestedContributionAmount: 0,
          realizedContributionAmount: 0,
          transferAmount: 0,
          growthNetWorthImpact: 0,
          requestedContributionAmountsByPlanId: {},
          realizedContributionAmountsByPlanId: {},
        })
      );
    }
  }

  Object.assign(futureStartingBalances, balances);

  const sortedContributionPlans = pack.contributionPlans
    .map((plan, index) => ({ plan, index }))
    .filter(({ plan }) => plan.enabled)
    .sort((left, right) => left.plan.priority - right.plan.priority || left.index - right.index)
    .map(({ plan }) => plan);
  const enabledTransfers = pack.transfers.filter((transfer) => transfer.enabled);

  for (let offset = 0; offset < pack.scenario.horizonMonths; offset += 1) {
    const monthIndex = projectionStartMonthIndex + offset;
    const budgetItemAmountsById = buildBudgetItemAmountsById(pack.budgetItems, monthIndex);
    const investableCapacity = calculateInvestableCapacity(pack.budgetItems, budgetItemAmountsById);
    const requestedContributionAmountsByPlanId: Record<string, number> = {};
    const realizedContributionAmountsByPlanId: Record<string, number> = {};
    const yearKey = String(Math.floor(monthIndex / 12));
    let remainingCapacity = Math.max(0, investableCapacity);
    let requestedContributionAmount = 0;
    let realizedContributionAmount = 0;

    sortedContributionPlans.forEach((contributionPlan) => {
      if (!isScheduled(monthIndex, contributionPlan.startMonth, contributionPlan.endMonth, contributionPlan.frequencyMonths)) {
        return;
      }

      const requestedAmount = Math.max(0, getContributionRequestedAmount(contributionPlan, investableCapacity, budgetItemAmountsById));
      const targetAccount = accountById.get(contributionPlan.targetAccountId);
      const capKey = `${contributionPlan.id}:${yearKey}`;
      const annualCapRemaining = contributionPlan.annualCap === null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, contributionPlan.annualCap - (realizedContributionAmountByPlanAndYear.get(capKey) ?? 0));
      const maxTargetRealization = targetAccount?.balanceType === "liability"
        ? Math.max(0, balances[targetAccount.id] ?? 0)
        : Number.POSITIVE_INFINITY;
      const realizedAmount = Math.max(0, Math.min(requestedAmount, remainingCapacity, annualCapRemaining, maxTargetRealization));

      requestedContributionAmountsByPlanId[contributionPlan.id] = requestedAmount;
      realizedContributionAmountsByPlanId[contributionPlan.id] = realizedAmount;
      requestedContributionAmount += requestedAmount;
      realizedContributionAmount += realizedAmount;
      totalRequestedContributions += requestedAmount;
      totalRealizedContributions += realizedAmount;
      requestedContributionTotalsByPlanId.set(contributionPlan.id, (requestedContributionTotalsByPlanId.get(contributionPlan.id) ?? 0) + requestedAmount);
      realizedContributionTotalsByPlanId.set(contributionPlan.id, (realizedContributionTotalsByPlanId.get(contributionPlan.id) ?? 0) + realizedAmount);
      realizedContributionAmountByPlanAndYear.set(capKey, (realizedContributionAmountByPlanAndYear.get(capKey) ?? 0) + realizedAmount);

      remainingCapacity -= realizedAmount;

      if (targetAccount && realizedAmount > 0) {
        applyContributionToBalance(targetAccount, balances, realizedAmount);
      }
    });

    let transferAmount = 0;

    enabledTransfers.forEach((transfer) => {
      if (!isScheduled(monthIndex, transfer.startMonth, transfer.endMonth, transfer.frequencyMonths)) {
        return;
      }

      const realizedAmount = resolveTransferAmount(transfer, balances, accountById);
      if (realizedAmount <= 0) {
        return;
      }

      applyTransfer(transfer, realizedAmount, balances, accountById);
      transferAmount += realizedAmount;
      totalTransferAmount += realizedAmount;
    });

    let growthNetWorthImpact = 0;

    pack.accounts.forEach((account) => {
      const currentBalance = balances[account.id] ?? 0;
      if (currentBalance <= 0 || account.annualRate === 0) {
        return;
      }

      const monthlyRate = Math.pow(1 + account.annualRate, 1 / 12) - 1;
      const growthAmount = currentBalance * monthlyRate;
      balances[account.id] = currentBalance + growthAmount;
      growthNetWorthImpact += account.balanceType === "liability" ? -growthAmount : growthAmount;
    });

    totalGrowthNetWorthImpact += growthNetWorthImpact;
    totalProjectedInvestableCapacity += investableCapacity;
    projectedMonthCount += 1;

    monthlyRows.push(
      createRow({
        monthIndex,
        isHistorical: false,
        balances,
        accounts: pack.accounts,
        investableCapacity,
        requestedContributionAmount,
        realizedContributionAmount,
        transferAmount,
        growthNetWorthImpact,
        requestedContributionAmountsByPlanId,
        realizedContributionAmountsByPlanId,
      })
    );
  }

  const sampledRows = monthlyRows.filter((row, index) => index === 0 || index === monthlyRows.length - 1 || row.monthIndex % 3 === 0);
  const latestHistoricalRow = [...monthlyRows].reverse().find((row) => row.isHistorical) ?? null;
  const latestRow = monthlyRows[monthlyRows.length - 1] ?? null;
  const currentNetWorth = latestHistoricalRow?.netWorth ?? computeNetWorth(futureStartingBalances, pack.accounts);
  const hitTargetRow = monthlyRows.find((row) => !row.isHistorical && row.netWorth >= pack.scenario.targetNetWorth) ?? null;

  const accountSummaries: CsvProjectionAccountSummary[] = pack.accounts.map((account) => {
    const endingBalance = latestRow?.accountBalances[account.id] ?? futureStartingBalances[account.id] ?? account.openingBalance;
    const startingBalance = futureStartingBalances[account.id] ?? account.openingBalance;

    return {
      accountId: account.id,
      label: account.label,
      balanceType: account.balanceType,
      color: account.color,
      annualRate: account.annualRate,
      enabled: account.enabled,
      openingBalance: roundCurrency(account.openingBalance),
      startingBalance: roundCurrency(startingBalance),
      endingBalance: roundCurrency(endingBalance),
      signedEndingBalance: roundCurrency(account.balanceType === "liability" ? -endingBalance : endingBalance),
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
      monthlyRows: monthlyRows.map(roundRow),
      sampledRows: sampledRows.map(roundRow),
    },
    accountSummaries,
    contributionSummaries,
    totals: {
      requestedContributions: roundCurrency(totalRequestedContributions),
      realizedContributions: roundCurrency(totalRealizedContributions),
      transferAmount: roundCurrency(totalTransferAmount),
      growthNetWorthImpact: roundCurrency(totalGrowthNetWorthImpact),
      averageProjectedInvestableCapacity: projectedMonthCount > 0 ? roundCurrency(totalProjectedInvestableCapacity / projectedMonthCount) : 0,
      latestProjectedInvestableCapacity: latestRow && !latestRow.isHistorical ? roundCurrency(latestRow.investableCapacity) : 0,
    },
    milestones: {
      hitTargetMonthIndex: hitTargetRow?.monthIndex ?? null,
      hitTargetMonthLabel: hitTargetRow?.monthLabel ?? null,
      latestCheckpointDate: normalizedCheckpoints.latestCheckpointDate,
      latestCheckpointMonthLabel: normalizedCheckpoints.latestCheckpointMonthLabel,
      latestHistoricalMonthLabel: latestHistoricalRow?.monthLabel ?? null,
    },
    summary: {
      currentNetWorth: roundCurrency(currentNetWorth),
      finalNetWorth: roundCurrency(latestRow?.netWorth ?? currentNetWorth),
    },
  };
}
