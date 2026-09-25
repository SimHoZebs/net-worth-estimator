import type { Goal, Movement, Plan } from './model.ts';
import { netWorth } from './model.ts';
import { isoDate, sum } from './format.ts';

export interface Point { date: string; total: number; balances: Record<string, number> }
export interface Occurrence { date: string; movement: Movement; amount: number }
export interface MovementAccountDelta { accountId: string; delta: number }
export interface MovementResult {
  date: string; movementId: string; name: string; requested: number; realized: number;
  fromId: string | null; toId: string | null; available: number | null; constraint: string | null;
  accountDeltas: MovementAccountDelta[];
  constraintTypes?: string[];
}
export interface GoalResult { goal: Goal; firstDate: string | null; current: number; final: number }
export interface Projection {
  points: Point[]; currentNetWorth?: number; movements: MovementResult[]; firstFailure: MovementResult | null;
  goals: GoalResult[]; inflows: number; outflows: number; transfers: number;
  startDateHasCheckpoint?: boolean;
}
export interface RangePoint { date: string; lower: number; median: number; upper: number }
export interface RangeResult { points: RangePoint[]; count: number; goalSuccess: Record<string, number>; failureShare: number }

export function currentNetWorth({ projection, plan }: { projection: Projection; plan: Plan }): number {
  return projection.currentNetWorth ?? netWorth(plan);
}

function monthDate({ year, month, day }: { year: number; month: number; day: number }) {
  const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return isoDate(new Date(Date.UTC(year, month, Math.min(day, maxDay))));
}

export function horizonDate({ start, years }: { start: string; years: number }) {
  const value = new Date(`${start}T12:00:00Z`);
  return monthDate({ year: value.getUTCFullYear() + years, month: value.getUTCMonth(), day: value.getUTCDate() });
}

export function occurrences({ plan, endDate }: { plan: Plan; endDate: string }): Occurrence[] {
  const result: Occurrence[] = [];
  for (const movement of plan.movements) {
    if (!movement.enabled || movement.provenance === 'recorded') continue;
    if (movement.fromId && !plan.accounts.some((account) => account.id === movement.fromId && account.enabled)) continue;
    if (movement.toId && !plan.accounts.some((account) => account.id === movement.toId && account.enabled)) continue;
    const start = new Date(`${movement.startDate}T12:00:00Z`);
    const firstYear = start.getUTCFullYear();
    const firstMonth = start.getUTCMonth();
    const endYear = Number(endDate.slice(0, 4));
    const append = (date: string) => {
      if (date <= plan.startDate || date < movement.startDate || date > endDate || (movement.endDate && date > movement.endDate)) return;
      const yearDifference = Number(date.slice(0, 4)) - firstYear;
      const anniversary = monthDate({ year: firstYear + yearDifference, month: firstMonth, day: start.getUTCDate() });
      const elapsedYears = yearDifference - (date < anniversary ? 1 : 0);
      result.push({ date, movement, amount: movement.amount * Math.pow(1 + movement.annualIncrease / 100, Math.max(0, elapsedYears)) });
    };
    if (movement.frequency === 'once') { append(movement.startDate); continue; }
    for (let year = Math.max(firstYear, Number(plan.startDate.slice(0, 4))); year <= endYear; year++) {
      for (let month = 0; month < 12; month++) {
        if (movement.frequency === 'yearly' && month !== firstMonth) continue;
        append(monthDate({ year, month, day: start.getUTCDate() }));
      }
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}

export function project({ plan, years, annualShocks = [], recordMovements = true }: {
  plan: Plan; years: number; annualShocks?: number[]; recordMovements?: boolean;
}): Projection {
  const endDate = horizonDate({ start: plan.startDate, years });
  const events = occurrences({ plan, endDate });
  const byDate = new Map<string, Occurrence[]>();
  for (const event of events) byDate.set(event.date, [...(byDate.get(event.date) ?? []), event]);
  const markers = new Set<string>([plan.startDate, endDate]);
  const firstYear = Number(plan.startDate.slice(0, 4));
  for (let year = firstYear; year <= firstYear + years; year++) {
    for (let month = 0; month < 12; month++) {
      const date = monthDate({ year, month, day: 31 });
      if (date > plan.startDate && date < endDate) markers.add(date);
    }
  }
  const dates = [...new Set([...markers, ...byDate.keys()])].sort();
  const balances = Object.fromEntries(plan.accounts.filter((a) => a.enabled).map((a) => [a.id, a.balance]));
  const points: Point[] = [];
  const movements: MovementResult[] = [];
  const goals: GoalResult[] = plan.goals.filter((g) => g.enabled).map((goal) => ({ goal, firstDate: null, current: goalValue({ goal, balances }), final: 0 }));
  let previousDate = plan.startDate;
  let firstFailure: MovementResult | null = null;
  let inflows = 0;
  let outflows = 0;
  let transfers = 0;

  for (const date of dates) {
    // Month-end markers keep every accrual interval inside one calendar year's rate.
    const days = (Date.parse(date) - Date.parse(previousDate)) / 86400000;
    for (const account of plan.accounts.filter((item) => item.enabled)) {
      const shock = account.kind === 'investment' ? annualShocks[Number(date.slice(0, 4)) - firstYear] ?? 0 : 0;
      const rate = Math.max(-50, Math.min(50, account.annualReturn + shock));
      balances[account.id] = (balances[account.id] ?? 0) * Math.pow(1 + rate / 100, days / 365.25);
    }
    for (const event of byDate.get(date) ?? []) {
      const { movement } = event;
      const source = plan.accounts.find((a) => a.id === movement.fromId);
      const destination = plan.accounts.find((a) => a.id === movement.toId);
      const available = source ? Math.max(0, (balances[source.id] ?? 0) - source.floor) : Infinity;
      const debtRemaining = destination?.kind === 'debt' ? Math.max(0, -(balances[destination.id] ?? 0)) : Infinity;
      const headroom = destination && destination.ceiling !== null ? Math.max(0, destination.ceiling - (balances[destination.id] ?? 0)) : Infinity;
      const requested = Math.min(event.amount, debtRemaining);
      const realized = Math.max(0, Math.min(requested, available, headroom));
      if (source) balances[source.id] = (balances[source.id] ?? 0) - realized;
      if (destination) balances[destination.id] = (balances[destination.id] ?? 0) + realized;
      const constraint = realized + 0.01 < requested ? available < requested && available <= headroom ? 'Protected account balance' : 'Destination account ceiling' : null;
       const accountDeltas = [
         ...(source ? [{ accountId: source.id, delta: -realized }] : []),
         ...(destination ? [{ accountId: destination.id, delta: realized }] : []),
       ];
       const result: MovementResult = { date, movementId: movement.id, name: movement.name, requested, realized, fromId: movement.fromId, toId: movement.toId, available, constraint, accountDeltas };
      if (recordMovements) movements.push(result);
      if (constraint && !firstFailure) firstFailure = result;
      if (!source) inflows += realized;
      else if (!destination) outflows += realized;
      else transfers += realized;
    }
    if (markers.has(date)) points.push({ date, total: sum(Object.values(balances)), balances: { ...balances } });
    for (const result of goals) {
      const value = goalValue({ goal: result.goal, balances });
      if (value >= result.goal.target && !result.firstDate) result.firstDate = date;
      result.final = value;
    }
    previousDate = date;
  }
  return { points, currentNetWorth: netWorth(plan), movements, firstFailure, goals, inflows, outflows, transfers, startDateHasCheckpoint: plan.accounts.some((account) => account.enabled && account.observedOn === plan.startDate && account.provenance === 'recorded') };
}

export function goalValue({ goal, balances }: { goal: Goal; balances: Record<string, number> }) {
  return goal.kind === 'reserve' ? balances[goal.accountId ?? ''] ?? 0 : sum(Object.values(balances));
}

export function quantile({ values, fraction }: { values: number[]; fraction: number }) {
  const sorted = [...values].sort((a, b) => a - b);
  const index = (sorted.length - 1) * fraction;
  const lower = sorted[Math.floor(index)] ?? 0;
  return lower + ((sorted[Math.ceil(index)] ?? lower) - lower) * (index % 1);
}

export function calculateRange({ plan, years, count = 400, onProgress }: {
  plan: Plan; years: number; count?: number; onProgress?: (progress: number) => void;
}): RangeResult {
  let seed = 78431;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return (seed + 1) / 4294967297; };
  const distributions: number[][] = [];
  const goalSuccess = Object.fromEntries(plan.goals.filter((g) => g.enabled).map((g) => [g.id, 0]));
  let dates: string[] = [];
  let failures = 0;
  for (let run = 0; run < count; run++) {
    const annualShocks = Array.from({ length: years + 1 }, () => Math.sqrt(-2 * Math.log(random())) * Math.cos(2 * Math.PI * random()) * plan.assumptions.volatility);
    const result = project({ plan, years, annualShocks, recordMovements: false });
    if (run === 0) dates = result.points.map((p) => p.date);
    result.points.forEach((point, index) => { (distributions[index] ??= []).push(point.total); });
    for (const goal of result.goals) if (goal.firstDate) goalSuccess[goal.goal.id] = (goalSuccess[goal.goal.id] ?? 0) + 1 / count;
    if (result.firstFailure) failures++;
    if (run % 20 === 0) onProgress?.((run + 1) / count);
  }
  return {
    points: distributions.map((values, index) => ({ date: dates[index] ?? plan.startDate, lower: quantile({ values, fraction: 0.1 }), median: quantile({ values, fraction: 0.5 }), upper: quantile({ values, fraction: 0.9 }) })),
    count, goalSuccess, failureShare: failures / count,
  };
}
