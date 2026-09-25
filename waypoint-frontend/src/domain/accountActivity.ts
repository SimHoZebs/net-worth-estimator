import type { Plan } from './model.ts';
import type { Projection } from './projection.ts';
import { horizonDate } from './projection.ts';
import { shiftDate } from './format.ts';

export interface AccountTransaction {
  id: string;
  movementId: string;
  date: string;
  name: string;
  source: 'recorded' | 'projected';
  direction: 'in' | 'out';
  category: 'income' | 'expense' | 'transfer';
  counterparty: string;
  from: string;
  to: string;
  amount: number;
  requested: number;
  shortfall: number;
  constraint: string | null;
  excluded: boolean;
}

export interface ActivityFilters {
  query: string;
  source: 'all' | 'recorded' | 'projected';
  direction: 'all' | 'in' | 'out' | 'transfer';
  period: 'all' | '30-days' | '12-months';
  order: 'oldest' | 'newest';
}

export const defaultActivityFilters: ActivityFilters = { query: '', source: 'all', direction: 'all', period: 'all', order: 'oldest' };

type ConnectionMovement = Pick<Projection['movements'][number], 'fromId' | 'toId' | 'accountDeltas' | 'requested' | 'realized'>;

export function accountTransactions({ accountId, plan, projection }: { accountId: string; plan: Plan; projection: Projection }): AccountTransaction[] {
  if (!plan.accounts.some((account) => account.id === accountId)) return [];
  const names = new Map(plan.accounts.map((account) => [account.id, account.name]));
  const connection = (movement: ConnectionMovement) => {
    const deltas = movement.accountDeltas.length > 0
      ? movement.accountDeltas
      : [
        ...(movement.fromId ? [{ accountId: movement.fromId, delta: -movement.requested }] : []),
        ...(movement.toId ? [{ accountId: movement.toId, delta: movement.realized }] : []),
      ];
    const delta = deltas.find((item) => item.accountId === accountId);
    const destinationIds = deltas.filter((item) => item.delta > 0).map((item) => item.accountId);
    const direction = (delta?.delta ?? 0) < 0 ? 'out' as const : 'in' as const;
    const category = movement.fromId && destinationIds.length > 0 ? 'transfer' as const : movement.fromId ? 'expense' as const : 'income' as const;
    const from = movement.fromId ? names.get(movement.fromId) ?? 'Unknown account' : 'External income';
    const selectedIsSource = movement.fromId === accountId;
    const otherDestination = destinationIds.find((id) => id !== accountId);
    const to = selectedIsSource
      ? (otherDestination ? names.get(otherDestination) ?? 'Unknown account' : 'External spending')
      : names.get(accountId) ?? 'Unknown account';
    return { direction, category, from, to, counterparty: direction === 'in' ? from : to };
  };
  const recorded: AccountTransaction[] = plan.movements
    .filter((movement) => movement.provenance === 'recorded' && movement.frequency === 'once' && (movement.fromId === accountId || movement.toId === accountId))
    .map((movement) => ({
      id: `recorded-${movement.id}`, movementId: movement.id, date: movement.startDate,
      name: movement.name, source: 'recorded', ...connection({ fromId: movement.fromId, toId: movement.toId, accountDeltas: [], requested: movement.amount, realized: movement.amount }), amount: movement.amount,
      requested: movement.amount, shortfall: 0, constraint: null, excluded: !movement.enabled,
    }));
  const startDateHasCheckpoint = projection.startDateHasCheckpoint ?? true;
  const projected: AccountTransaction[] = projection.movements
     .filter((movement) => (movement.date > plan.startDate || (movement.date === plan.startDate && !startDateHasCheckpoint)) && (movement.accountDeltas.length > 0 ? movement.accountDeltas.some((delta) => delta.accountId === accountId) : movement.fromId === accountId || movement.toId === accountId) && movement.requested > 0)
     .map((movement, index) => {
       const selectedDelta = movement.accountDeltas.find((delta) => delta.accountId === accountId);
       const destinationCount = movement.accountDeltas.filter((delta) => delta.delta > 0).length;
       const accountAmount = selectedDelta ? Math.abs(selectedDelta.delta) : movement.realized;
       const accountRequested = selectedDelta && selectedDelta.delta < 0 ? movement.requested : destinationCount > 1 ? accountAmount : movement.requested;
       return {
         id: `projected-${movement.movementId}-${movement.date}-${index}`, movementId: movement.movementId,
         date: movement.date, name: movement.name, source: 'projected', ...connection(movement),
         amount: accountAmount, requested: accountRequested,
         shortfall: Math.max(0, accountRequested - accountAmount), constraint: movement.constraint, excluded: false,
       };
     });
  return [...recorded, ...projected];
}

export function filterTransactions({ transactions, filters, startDate }: { transactions: AccountTransaction[]; filters: ActivityFilters; startDate: string }) {
  const query = filters.query.trim().toLocaleLowerCase();
  const end = filters.period === '30-days' ? shiftDate({ date: startDate, days: 30 }) : horizonDate({ start: startDate, years: 1 });
  return transactions.filter((transaction) => {
    if (filters.source !== 'all' && transaction.source !== filters.source) return false;
    if (filters.direction === 'transfer' && transaction.category !== 'transfer') return false;
    if (filters.direction === 'in' && transaction.direction !== 'in') return false;
    if (filters.direction === 'out' && transaction.direction !== 'out') return false;
    if (filters.period !== 'all' && (transaction.date <= startDate || transaction.date > end)) return false;
    return !query || `${transaction.name} ${transaction.counterparty} ${transaction.date}`.toLocaleLowerCase().includes(query);
  }).sort((a, b) => (filters.order === 'oldest' ? 1 : -1) * a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
}
