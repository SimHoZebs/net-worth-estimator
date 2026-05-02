export const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export const pct = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 1,
});

export const integer = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export const decimal = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

export function formatChartCurrencyTick(value: number): string {
  return `$${Math.round(value / 1000)}k`;
}

export function formatTooltipCurrency(value: unknown): string {
  return currency.format(Number(value ?? 0));
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

export function formatRoute(
  sourceLabel: string | null,
  destinations: Array<{ label: string }> | null
): string {
  const src = sourceLabel ?? "External";
  const dst = destinations === null ? "External" : destinations.map((d) => d.label).join(" ; ");
  return `${src} -> ${dst}`;
}
