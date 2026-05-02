import type {
  ScenarioPack,
  ScenarioWhatIfState,
  ProjectionRuntimeSettings,
} from "../types/scenario";
import { projectScenarioPack } from "./scenarioProject";
import type { StochasticBandRow, StochasticConfig, StochasticProjectionResult } from "../types/stochastic";
import { computePercentiles, reseed, sampleLogNormal } from "../utils/stochastic";

function clonePack(pack: ScenarioPack): ScenarioPack {
  return {
    ...pack,
    accounts: pack.accounts.map((a) => ({ ...a })),
    checkpoints: pack.checkpoints.map((c) => ({ ...c })),
    postings: pack.postings.map((p) => ({ ...p, destinations: p.destinations ? [...p.destinations] : null })),
  };
}

function generateYearlyRates(
  expectedReturn: number,
  volatility: number,
  yearCount: number
): number[] {
  const rates: number[] = [];
  for (let i = 0; i < yearCount; i++) {
    rates.push(sampleLogNormal(expectedReturn, volatility));
  }
  return rates;
}

function buildStochasticRates(
  pack: ScenarioPack,
  projectionSettings: ProjectionRuntimeSettings
): Map<string, number[]> {
  const rates = new Map<string, number[]>();
  pack.accounts.forEach((account) => {
    if (account.volatility > 0 && account.enabled) {
      rates.set(
        account.id,
        generateYearlyRates(account.annualRate, account.volatility, projectionSettings.horizonYears)
      );
    }
  });
  return rates;
}

interface NetWorthSnapshot {
  date: string;
  netWorth: number;
  isHistorical: boolean;
  hitTarget: boolean;
}

function runAndExtract(
  pack: ScenarioPack,
  projectionSettings: ProjectionRuntimeSettings,
  whatIfState: ScenarioWhatIfState,
  stochasticRates: Map<string, number[]>
): NetWorthSnapshot[] {
  const result = projectScenarioPack(pack, projectionSettings, whatIfState, stochasticRates);
  return result.timeline.rows.map((row) => ({
    date: row.date,
    netWorth: row.netWorth,
    isHistorical: row.isHistorical,
    hitTarget: !row.isHistorical && row.netWorth >= projectionSettings.targetNetWorth,
  }));
}

function buildBands(snapshotsByRun: NetWorthSnapshot[][], sortedDates: string[]): StochasticBandRow[] {
  const netWorthsByDate = new Map<string, number[]>();
  const isHistoricalByDate = new Map<string, boolean>();

  snapshotsByRun.forEach((snapshots) => {
    const dateIndex = new Map(snapshots.map((s) => [s.date, s]));

    sortedDates.forEach((date) => {
      const snapshot = dateIndex.get(date);
      if (!snapshot) {
        return;
      }

      if (!netWorthsByDate.has(date)) {
        netWorthsByDate.set(date, []);
        isHistoricalByDate.set(date, snapshot.isHistorical);
      }

      netWorthsByDate.get(date)!.push(snapshot.netWorth);
    });
  });

  return sortedDates.map((date) => {
    const values = netWorthsByDate.get(date) ?? [];
    return {
      date,
      isHistorical: isHistoricalByDate.get(date) ?? false,
      netWorth: computePercentiles(values),
    };
  });
}

export function stochasticProject(
  pack: ScenarioPack,
  projectionSettings: ProjectionRuntimeSettings,
  whatIfState: ScenarioWhatIfState,
  config: StochasticConfig
): StochasticProjectionResult {
  reseed(config.seed);
  const deterministic = projectScenarioPack(pack, projectionSettings, whatIfState);

  const snapshotsByRun: NetWorthSnapshot[][] = [];

  for (let i = 0; i < config.runCount; i++) {
    const cloned = clonePack(pack);
    const rates = buildStochasticRates(cloned, projectionSettings);
    const snapshots = runAndExtract(cloned, projectionSettings, whatIfState, rates);
    snapshotsByRun.push(snapshots);
  }

  const dateSet = new Set<string>();
  snapshotsByRun.forEach((snapshots) => {
    snapshots.forEach((s) => dateSet.add(s.date));
  });
  const sortedDates = Array.from(dateSet).sort();

  const bands = buildBands(snapshotsByRun, sortedDates);

  const finalRowBands = bands[bands.length - 1];
  const finalNetWorthPercentiles = finalRowBands?.netWorth ?? { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };

  let medianHitDate: string | null = null;
  let worstCaseHitDate: string | null = null;

  bands.forEach((band) => {
    if (band.isHistorical) {
      return;
    }

    if (medianHitDate === null && band.netWorth.p50 >= projectionSettings.targetNetWorth) {
      medianHitDate = band.date;
    }

    if (worstCaseHitDate === null && band.netWorth.p10 >= projectionSettings.targetNetWorth) {
      worstCaseHitDate = band.date;
    }
  });

  const hitCount = snapshotsByRun.filter((snapshots) =>
    snapshots.some((s) => s.hitTarget)
  ).length;
  const hitTargetProbability = snapshotsByRun.length > 0 ? hitCount / snapshotsByRun.length : 0;

  return {
    config,
    deterministic,
    bands,
    milestones: {
      hitTargetProbability,
      medianHitTargetDate: medianHitDate,
      worstCaseHitTargetDate: worstCaseHitDate,
      finalNetWorthPercentiles,
    },
  };
}
