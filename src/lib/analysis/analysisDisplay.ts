import { formatDate } from "@/lib/format";
import type { AnalysisDiagnostic } from "./types";

export const roundedUsd = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	maximumFractionDigits: 0,
});

export const exactUsd = new Intl.NumberFormat("en-US", {
	style: "currency",
	currency: "USD",
	minimumFractionDigits: 2,
	maximumFractionDigits: 2,
});

export function formatRoundedUsd(amount: number): string {
	return roundedUsd.format(amount);
}

export function formatExactUsd(amount: number | null): string {
	if (amount === null || !Number.isFinite(amount)) return "Unknown amount";
	return exactUsd.format(amount);
}

export function formatPostingDate(isoDate: string): string {
	return formatDate(isoDate);
}

export interface DiagnosticPresentation {
	containerClassName: string;
	role: "status" | "alert";
	label: string;
}

export function diagnosticPresentation(
	severity: AnalysisDiagnostic["severity"],
): DiagnosticPresentation {
	if (severity === "error") {
		return {
			containerClassName:
				"rounded-xl border border-destructive/25 bg-destructive-subtle px-3 py-2 type-caption text-destructive-foreground",
			role: "alert",
			label: "Error",
		};
	}
	if (severity === "warning") {
		return {
			containerClassName:
				"rounded-xl border border-tertiary-border bg-tertiary-subtle px-3 py-2 type-caption text-tertiary-foreground",
			role: "status",
			label: "Warning",
		};
	}
	return {
		containerClassName:
			"rounded-xl border border-border/70 bg-muted/30 px-3 py-2 type-caption text-muted-foreground",
		role: "status",
		label: "Note",
	};
}

export const PAYROLL_FIX_HINTS: readonly string[] = [
	"Add payroll or salary wording to the posting label (payroll, salary, paycheck, wages, or direct deposit).",
	"Check the amount is greater than zero and uses a constant number.",
	"Need at least three deposits from the same payer into the same account.",
];

export type SalaryStatus = "confirmed" | "provisional" | "unavailable";

export interface SalaryStatusCopy {
	heading: string;
	explainer: string;
	annualizationNote: string;
}

export function salaryStatusCopy(status: SalaryStatus): SalaryStatusCopy {
	if (status === "confirmed") {
		return {
			heading: "Confirmed estimate",
			explainer:
				"Three or more comparable deposits support a stable cadence. The annualized range below scales the typical deposit by that cadence.",
			annualizationNote: "per year, observed net deposits",
		};
	}
	if (status === "provisional") {
		return {
			heading: "Provisional estimate",
			explainer:
				"Two comparable deposits support a per-deposit figure. Annualization is withheld until three or more comparable deposits are observed.",
			annualizationNote: "per deposit; annualization withheld",
		};
	}
	return {
		heading: "No defensible estimate yet",
		explainer:
			"There is not yet a recurring payroll series to annualize. Add comparable one-time external inflow postings to establish payer identity and cadence.",
		annualizationNote: "no estimate available",
	};
}

export interface AnalysisTerm {
	term: string;
	definition: string;
}

export const ANALYSIS_TERMS: readonly AnalysisTerm[] = [
	{
		term: "Observed",
		definition:
			"Observed postings are enabled one-time external inflows already in the current model. Recurring model rules are never treated as observed pay.",
	},
	{
		term: "Comparable",
		definition:
			"Observed deposits with similar amounts and steady timing that can support the same cadence.",
	},
	{
		term: "Supporting",
		definition:
			"The comparable deposits backing the current estimate. Amount outliers are listed separately as excluded.",
	},
];

export function describeRail(rail: string): string {
	if (rail === "unknown") return "Rail unknown";
	return `Rail ${rail.toUpperCase()}`;
}
