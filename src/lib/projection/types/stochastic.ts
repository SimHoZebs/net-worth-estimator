import type { CsvProjectionResult, IsoDate } from "./csv";

export interface StochasticConfig {
  runCount: number;
  seed: number | null;
}

export interface PercentileBands {
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

export interface StochasticBandRow {
  date: IsoDate;
  isHistorical: boolean;
  netWorth: PercentileBands;
}

export interface StochasticProjectionResult {
  config: StochasticConfig;
  deterministic: CsvProjectionResult;
  bands: StochasticBandRow[];
  milestones: {
    hitTargetProbability: number;
    medianHitTargetDate: IsoDate | null;
    worstCaseHitTargetDate: IsoDate | null;
    finalNetWorthPercentiles: PercentileBands;
  };
}
