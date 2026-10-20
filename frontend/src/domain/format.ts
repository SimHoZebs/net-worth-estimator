const currency = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 0,
});
const transactionCurrency = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});
export const money = (value: number) => currency.format(value);
export const exactMoney = (value: number) => transactionCurrency.format(value);
export const compactMoney = (value: number) =>
	Math.abs(value) >= 1e6
		? `$${(value / 1e6).toFixed(2)}M`
		: Math.abs(value) >= 1000
			? `$${(value / 1000).toFixed(0)}k`
			: money(value);
export const dateLabel = (value: string, full = false) =>
	new Intl.DateTimeFormat("en-US", {
		month: "short",
		...(full ? { day: "numeric" as const } : {}),
		year: "numeric",
		timeZone: "UTC",
	}).format(new Date(`${value.slice(0, 10)}T12:00:00Z`));
export const monthDay = (value: string) =>
	new Intl.DateTimeFormat("en-US", {
		month: "short",
		day: "numeric",
		timeZone: "UTC",
	}).format(utcDate(value));
export const percent = (value: number) => `${Math.round(value * 100)}%`;
export const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
export const isoDate = (value: Date) => value.toISOString().slice(0, 10);
/** Real calendar day in UTC. Display dates anchor on this, never on stale data. */
export const todayIso = () => isoDate(new Date());
export function shiftDate({ date, days }: { date: string; days: number }) {
	const value = new Date(`${date}T12:00:00Z`);
	value.setUTCDate(value.getUTCDate() + days);
	return isoDate(value);
}

/** Single browser date owner. All YYYY-MM-DD parsing goes through here. */
export function utcDate(iso: string): Date {
	return new Date(`${iso.slice(0, 10)}T12:00:00Z`);
}

export function isIsoDate(value: string): boolean {
	return (
		/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(utcDate(value).getTime())
	);
}

export function daysBetweenInclusive(startIso: string, endIso: string): number {
	const start = utcDate(startIso).getTime();
	const end = utcDate(endIso).getTime();
	return Math.round((end - start) / 86_400_000) + 1;
}

export function clampMonth({
	year,
	month,
	day,
}: {
	year: number;
	month: number;
	day: number;
}): string {
	const maxDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	return isoDate(
		new Date(Date.UTC(year, month, Math.min(day, maxDay), 12, 0, 0)),
	);
}
