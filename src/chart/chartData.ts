import type {
	FinancialModelDocument,
	ProjectionResult,
	StochasticProjectionResult,
} from "@/lib/projection";

export function parseChartDate(iso: string): number {
	const parts = iso.split("-");
	return new Date(
		Number(parts[0]),
		Number(parts[1]) - 1,
		Number(parts[2]),
	).getTime();
}

export function buildBalanceChartData(
	document: FinancialModelDocument,
	result: ProjectionResult,
) {
	const enabledAccounts = document.accounts.filter(
		(account) => account.enabled,
	);

	return result.timeline.sampledRows.map((row) => {
		const balanceByAccountId = new Map<string, number>();
		for (const snapshot of row.accountSnapshots) {
			if (!balanceByAccountId.has(snapshot.accountId)) {
				balanceByAccountId.set(snapshot.accountId, snapshot.balance);
			}
		}
		return {
			date: row.date,
			...Object.fromEntries(
				enabledAccounts.map((account) => [
					account.id,
					balanceByAccountId.get(account.id) ?? 0,
				]),
			),
		};
	});
}

export function buildAccountDiagnosticChartData(
	document: FinancialModelDocument,
	result: ProjectionResult,
) {
	const enabledAccounts = document.accounts.filter(
		(account) => account.enabled,
	);

	return result.timeline.sampledRows.map((row) => {
		const entry: Record<string, string | number> = {
			date: row.date,
			netWorth: row.netWorth,
		};
		const balanceByAccountId = new Map<string, number>();
		for (const snapshot of row.accountSnapshots) {
			if (!balanceByAccountId.has(snapshot.accountId)) {
				balanceByAccountId.set(snapshot.accountId, snapshot.balance);
			}
		}
		for (const account of enabledAccounts) {
			entry[account.id] = balanceByAccountId.get(account.id) ?? 0;
		}

		return entry;
	});
}

export interface StochasticChartRow {
	date: string;
	netWorth: number;
	p10_base: number;
	outerThickness: number;
	p25_base: number;
	innerThickness: number;
	p50: number;
	_p10: number;
	_p90: number;
	_p25: number;
	_p75: number;
}

export function buildStochasticChartData(
	result: ProjectionResult,
	stochasticResult: StochasticProjectionResult,
): StochasticChartRow[] {
	const bandDateIndex = new Map(
		stochasticResult.bands.map((band) => [band.date, band]),
	);
	return result.timeline.sampledRows.map((row) => {
		const band = bandDateIndex.get(row.date);
		const p10 = band?.netWorth.p10 ?? row.netWorth;
		const p25 = band?.netWorth.p25 ?? row.netWorth;
		const p50 = band?.netWorth.p50 ?? row.netWorth;
		const p75 = band?.netWorth.p75 ?? row.netWorth;
		const p90 = band?.netWorth.p90 ?? row.netWorth;

		return {
			date: row.date,
			netWorth: row.netWorth,
			p10_base: p10,
			outerThickness: p90 - p10,
			p25_base: p25,
			innerThickness: p75 - p25,
			p50,
			_p10: p10,
			_p90: p90,
			_p25: p25,
			_p75: p75,
		};
	});
}

export { formatRoute } from "@/lib/format";
