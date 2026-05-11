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
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  }
  if (abs >= 1_000) {
    return `${sign}$${(abs / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  }
  return `${sign}$${abs}`;
}

export function formatDate(isoDate: string): string {
  if (!isoDate || isoDate.length < 10) return isoDate;
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function formatElapsedTime(startIsoDate: string, endIsoDate: string): string {
  if (!startIsoDate || !endIsoDate || startIsoDate.length < 10 || endIsoDate.length < 10) {
    return "Unknown";
  }

  const [startYear, startMonth, startDay] = startIsoDate.split("-").map(Number);
  const [endYear, endMonth, endDay] = endIsoDate.split("-").map(Number);

  if (![startYear, startMonth, startDay, endYear, endMonth, endDay].every(Number.isFinite)) {
    return "Unknown";
  }

  let totalMonths = (endYear - startYear) * 12 + (endMonth - startMonth);
  if (endDay < startDay) totalMonths -= 1;

  if (totalMonths > 0) {
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;
    if (years > 0 && months > 0) return `${years}y ${months}m`;
    if (years > 0) return `${years}y`;
    return `${months}m`;
  }

  const startDate = new Date(startYear, startMonth - 1, startDay);
  const endDate = new Date(endYear, endMonth - 1, endDay);
  const days = Math.round((endDate.getTime() - startDate.getTime()) / (24 * 60 * 60 * 1000));
  return days <= 0 ? "Now" : `${days}d`;
}

export function formatTooltipCurrency(value: unknown): string {
  return currency.format(Number(value ?? 0));
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return `${count} ${count === 1 ? singular : (plural ?? `${singular}s`)}`;
}

export function formatFrequency(freq: string): string {
  const map: Record<string, string> = {
    daily: "Daily",
    weekly: "Weekly",
    monthly: "Monthly",
    quarterly: "Quarterly",
    annual: "Annual",
  };
  return map[freq] ?? freq;
}

export function formatCurrencyInput(value: string): string {
  const num = Number(value);
  if (!Number.isFinite(num)) return value;
  return currency.format(num);
}

export function formatRoute(
  sourceLabel: string | null,
  destinations: Array<{ label: string }> | null
): string {
  const src = sourceLabel ?? "External";
  const dst = destinations === null ? "External" : destinations.map((d) => d.label).join(" ; ");
  return `${src} -> ${dst}`;
}
