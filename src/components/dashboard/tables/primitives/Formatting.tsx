import { currency, formatDate } from "@/lib/format";

/** Currency cell content rendering "-" for unavailable values. */
export function CurrencyText({ value }: { value: number | null }) {
	return <>{value === null ? "-" : currency.format(value)}</>;
}

/** Date cell content in display format. */
export function DateText({ value }: { value: string }) {
	return <>{formatDate(value)}</>;
}
