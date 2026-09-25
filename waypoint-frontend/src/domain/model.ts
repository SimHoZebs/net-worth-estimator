import { z } from 'zod';

const date = z.iso.date();
const money = z.number().finite().min(0).max(1e10);
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(100);

export const accountSchema = z.object({
  id, name,
  kind: z.enum(['cash', 'investment', 'property', 'debt']),
  enabled: z.boolean().default(true),
  balance: z.number().finite().min(-1e10).max(1e10),
  annualReturn: z.number().min(-50).max(50),
  floor: money,
  ceiling: money.nullable(),
  observedOn: date,
  provenance: z.enum(['recorded', 'modeled']),
  source: name,
  readOnly: z.boolean(),
});

export const movementSchema = z.object({
  id, name, amount: money, amountKnown: z.boolean().default(true),
  fromId: id.nullable(),
  toId: id.nullable(),
  frequency: z.enum(['monthly', 'yearly', 'once']),
  startDate: date,
  endDate: date.nullable(),
  annualIncrease: z.number().min(-50).max(50),
  enabled: z.boolean(),
  provenance: z.enum(['planned', 'recorded']),
  readOnly: z.boolean(),
});

export const goalSchema = z.object({
  id, name,
  kind: z.enum(['net-worth', 'reserve']),
  target: money.positive(),
  accountId: id.nullable(),
  enabled: z.boolean(),
});

export const planSchema = z.object({
  schemaVersion: z.literal(1),
  name,
  origin: z.enum(['example', 'personal']),
  startDate: date,
  updatedAt: z.iso.datetime(),
  revision: z.number().int().min(1),
  readOnly: z.boolean(),
  accounts: z.array(accountSchema).min(1).max(50),
  movements: z.array(movementSchema).max(300),
  goals: z.array(goalSchema).max(30),
  assumptions: z.object({
    inflation: z.number().min(0).max(20),
    volatility: z.number().min(0).max(40),
  }),
}).superRefine((plan, context) => {
  const ids = new Set<string>();
  const issue = (path: (string | number)[], message: string) => context.addIssue({ code: 'custom', path, message });
  for (const [index, account] of plan.accounts.entries()) {
    if (ids.has(account.id)) issue(['accounts', index, 'id'], 'Account IDs must be unique.');
    ids.add(account.id);
    if (account.kind === 'debt' && account.balance > 0) issue(['accounts', index, 'balance'], 'Enter debt as a negative balance.');
    if (account.kind !== 'debt' && account.balance < 0) issue(['accounts', index, 'balance'], 'Asset balances cannot be negative.');
    if (account.ceiling !== null && account.ceiling < account.floor) issue(['accounts', index, 'ceiling'], 'The ceiling must be at least the protected balance.');
    if (account.observedOn > plan.startDate) issue(['accounts', index, 'observedOn'], 'A balance check cannot follow the projection start.');
  }
  const movementIds = new Set<string>();
  for (const [index, movement] of plan.movements.entries()) {
    if (movementIds.has(movement.id)) issue(['movements', index, 'id'], 'Movement IDs must be unique.');
    movementIds.add(movement.id);
    if (!movement.fromId && !movement.toId) issue(['movements', index], 'Choose a source or destination account.');
    if (movement.fromId && movement.fromId === movement.toId) issue(['movements', index], 'Source and destination must differ.');
    for (const key of ['fromId', 'toId'] as const) {
      if (movement[key] && !ids.has(movement[key])) issue(['movements', index, key], 'Choose an existing account.');
    }

    if (movement.endDate && movement.endDate < movement.startDate) issue(['movements', index, 'endDate'], 'End date must follow the first occurrence.');
    if (movement.provenance === 'recorded' && movement.frequency !== 'once') issue(['movements', index, 'frequency'], 'Recorded movements must be one-time records.');
    if (movement.provenance === 'recorded' && movement.startDate > plan.startDate) issue(['movements', index, 'startDate'], 'Recorded movements cannot be in the future.');
  }
  const goalIds = new Set<string>();
  for (const [index, goal] of plan.goals.entries()) {
    if (goalIds.has(goal.id)) issue(['goals', index, 'id'], 'Goal IDs must be unique.');
    goalIds.add(goal.id);
    if (goal.kind === 'reserve' && (!goal.accountId || !ids.has(goal.accountId))) issue(['goals', index, 'accountId'], 'Select the account for this reserve goal.');
  }
});

export type Account = z.infer<typeof accountSchema>;
export type Movement = z.infer<typeof movementSchema>;
export type Goal = z.infer<typeof goalSchema>;
export type Plan = z.infer<typeof planSchema>;

export function validatePlan(value: unknown): Plan | Error {
  const result = planSchema.safeParse(value);
  if (!result.success) return new Error(result.error.issues.map((item) => `${item.path.join('.')}: ${item.message}`).join('\n'));
  return result.data;
}

export function netWorth(plan: Plan) {
  return plan.accounts.filter((account) => account.enabled).reduce((sum, account) => sum + account.balance, 0);
}

export function changesBetween({ saved, current }: { saved: Plan; current: Plan }) {
  const changes: { label: string; kind: 'Added' | 'Modified' | 'Removed'; before: string; after: string }[] = [];
  for (const key of ['accounts', 'movements', 'goals'] as const) {
    for (const item of current[key]) {
      const previous = saved[key].find((old) => old.id === item.id);
      if (!previous) changes.push({ label: item.name, kind: 'Added', before: '', after: JSON.stringify(item) });
      else if (JSON.stringify(previous) !== JSON.stringify(item)) changes.push({ label: item.name, kind: 'Modified', before: JSON.stringify(previous), after: JSON.stringify(item) });
    }
    for (const item of saved[key]) {
      if (!current[key].some((next) => next.id === item.id)) changes.push({ label: item.name, kind: 'Removed', before: JSON.stringify(item), after: '' });
    }
  }
  if (JSON.stringify(saved.assumptions) !== JSON.stringify(current.assumptions)) changes.push({ label: 'Projection assumptions', kind: 'Modified', before: JSON.stringify(saved.assumptions), after: JSON.stringify(current.assumptions) });
  if (saved.name !== current.name || saved.startDate !== current.startDate) changes.push({ label: 'Plan details', kind: 'Modified', before: saved.name, after: current.name });
  return changes;
}
