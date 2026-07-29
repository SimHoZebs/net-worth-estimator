import { formatDate } from "@/lib/format";
import type { Account } from "@/lib/projection";

export interface PointAccountDetails {
	id: string;
	label: string;
	color: string | null;
	value: number;
}

export interface ProjectionInterval {
	label: string;
	percentiles: string;
	lower: number;
	upper: number;
}

export interface PointDetails {
	date: string;
	netWorth: number;
	netWorthLabel: "Median net worth" | "Net worth";
	accounts: PointAccountDetails[];
	intervals: ProjectionInterval[];
}

interface BuildPointDetailsOptions {
	row: Record<string, string | number>;
	accounts: Account[];
	hasStochasticData: boolean;
}

export function buildPointDetails({
	row,
	accounts,
	hasStochasticData,
}: BuildPointDetailsOptions): PointDetails {
	const netWorth = Number(
		hasStochasticData ? (row.p50 ?? row.netWorth) : row.netWorth,
	);
	const pointAccounts = accounts
		.map((account) => ({
			id: account.id,
			label: account.label,
			color: account.color,
			value: Number(row[account.id] ?? 0),
		}))
		.filter((account) => account.value !== 0)
		.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

	return {
		date: formatDate(String(row.date)),
		netWorth,
		netWorthLabel: hasStochasticData ? "Median net worth" : "Net worth",
		accounts: pointAccounts,
		intervals: hasStochasticData
			? [
					{
						label: "Likely range",
						percentiles: "P25-P75",
						lower: Number(row._p25 ?? netWorth),
						upper: Number(row._p75 ?? netWorth),
					},
					{
						label: "Wider range",
						percentiles: "P10-P90",
						lower: Number(row._p10 ?? netWorth),
						upper: Number(row._p90 ?? netWorth),
					},
				]
			: [],
	};
}

export function groupPointAccounts(
	accounts: PointAccountDetails[],
	limit: number,
): { visible: PointAccountDetails[]; hidden: PointAccountDetails[] } {
	return {
		visible: accounts.slice(0, limit),
		hidden: accounts.slice(limit),
	};
}

export function formatPointDetailsSummary(details: PointDetails): string {
	const intervals = details.intervals
		.map(
			(interval) =>
				`${interval.label}, ${interval.percentiles}, ${interval.lower} to ${interval.upper}`,
		)
		.join(". ");
	const accounts = details.accounts
		.map((account) => `${account.label}, ${account.value}`)
		.join(". ");
	return [
		`${details.date}. ${details.netWorthLabel} ${details.netWorth}.`,
		intervals,
		accounts,
	]
		.filter(Boolean)
		.join(" ");
}
