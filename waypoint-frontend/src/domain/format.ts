const currency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const transactionCurrency = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (value: number) => currency.format(value);
export const exactMoney = (value: number) => transactionCurrency.format(value);
export const compactMoney = (value: number) => Math.abs(value) >= 1e6 ? `$${(value / 1e6).toFixed(2)}M` : Math.abs(value) >= 1000 ? `$${(value / 1000).toFixed(0)}k` : money(value);
export const dateLabel = (value: string, full = false) => new Intl.DateTimeFormat('en-US', { month: 'short', ...(full ? { day: 'numeric' as const } : {}), year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export const isoDate = (value: Date) => value.toISOString().slice(0, 10);
export function shiftDate({ date, days }: { date: string; days: number }) {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return isoDate(value);
}
