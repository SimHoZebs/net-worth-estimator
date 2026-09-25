import type { Plan } from './model.ts';
import { quantile } from './projection.ts';

export function payEvidence(plan: Plan) {
  const candidates = plan.movements.filter((m) => m.provenance === 'recorded' && m.frequency === 'once' && !m.fromId && m.toId);
  const selected = candidates.filter((m) => m.enabled && m.amountKnown && m.startDate <= plan.startDate);
  const typical = quantile({ values: selected.map((m) => m.amount), fraction: 0.5 });
  const comparable = selected.filter((m) => typical > 0 && Math.abs(m.amount - typical) / typical < 0.2);
  const ordered = [...comparable].sort((a, b) => a.startDate.localeCompare(b.startDate));
  const gaps = ordered.slice(1).map((m, i) => (Date.parse(m.startDate) - Date.parse(ordered[i]?.startDate ?? m.startDate)) / 86400000);
  const monthly = gaps.length >= 2 && gaps.every((gap) => gap >= 27 && gap <= 32);
  return { candidates, comparable, excluded: candidates.filter((m) => !comparable.includes(m)), typical, monthly, annualized: monthly ? typical * 12 : null, strong: comparable.length >= 6 && monthly };
}
