import type {
  ProjectionResult,
  ScenarioPack,
} from "@/lib/projection";
import type { StochasticProjectionResult } from "@/lib/projection";

export function buildBalanceChartData(pack: ScenarioPack, result: ProjectionResult) {
  const enabledAccounts = pack.accounts.filter((account) => account.enabled);

  return result.timeline.sampledRows.map((row) => ({
    date: row.date,
    ...Object.fromEntries(enabledAccounts.map((account) => [account.id, row.accountBalances[account.id] ?? 0])),
  }));
}

export function buildAccountDiagnosticChartData(
  pack: ScenarioPack,
  result: ProjectionResult,
  stochasticResult?: StochasticProjectionResult | null,
) {
  const enabledAccounts = pack.accounts.filter((a) => a.enabled);
  const hasStochastic = stochasticResult != null;

  const bandByDate = hasStochastic
    ? new Map(stochasticResult.bands.map((b) => [b.date, b]))
    : null;

  return result.timeline.sampledRows.map((row) => {
    const entry: Record<string, string | number> = {
      date: row.date,
      netWorth: row.netWorth,
    };

    for (const account of enabledAccounts) {
      entry[account.id] = row.accountBalances[account.id] ?? 0;
    }

    if (bandByDate) {
      const band = bandByDate.get(row.date);
      if (band) {
        entry.p10_base = band.netWorth.p10;
        entry.outerThickness = band.netWorth.p90 - band.netWorth.p10;
        entry.p25_base = band.netWorth.p25;
        entry.innerThickness = band.netWorth.p75 - band.netWorth.p25;
        entry.p50 = band.netWorth.p50;
        entry._p10 = band.netWorth.p10;
        entry._p90 = band.netWorth.p90;
        entry._p25 = band.netWorth.p25;
        entry._p75 = band.netWorth.p75;
        entry._hasStochastic = 1;
      } else {
        entry.p10_base = row.netWorth;
        entry.outerThickness = 0;
        entry.p25_base = row.netWorth;
        entry.innerThickness = 0;
        entry.p50 = row.netWorth;
        entry._p10 = row.netWorth;
        entry._p90 = row.netWorth;
        entry._p25 = row.netWorth;
        entry._p75 = row.netWorth;
        entry._hasStochastic = 0;
      }
    } else {
      entry.p10_base = row.netWorth;
      entry.outerThickness = 0;
      entry.p25_base = row.netWorth;
      entry.innerThickness = 0;
      entry.p50 = row.netWorth;
      entry._p10 = row.netWorth;
      entry._p90 = row.netWorth;
      entry._p25 = row.netWorth;
      entry._p75 = row.netWorth;
      entry._hasStochastic = 0;
    }

    return entry;
  });
}

export interface StochasticChartRow {
  date: string;
  p10_base: number;
  outerThickness: number;
  p25_base: number;
  innerThickness: number;
  p50: number;
}

export function buildStochasticChartData(result: ProjectionResult, stochasticResult: StochasticProjectionResult): StochasticChartRow[] {
  const bandDateIndex = new Map(stochasticResult.bands.map((band) => [band.date, band]));
  return result.timeline.rows.map((row) => {
    const band = bandDateIndex.get(row.date);
    const p10 = band?.netWorth.p10 ?? row.netWorth;
    const p25 = band?.netWorth.p25 ?? row.netWorth;
    const p50 = band?.netWorth.p50 ?? row.netWorth;
    const p75 = band?.netWorth.p75 ?? row.netWorth;
    const p90 = band?.netWorth.p90 ?? row.netWorth;

    return {
      date: row.date,
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
