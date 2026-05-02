import type {
  CsvProjectionResult,
  CsvScenarioPack,
  CsvScenarioWhatIfState,
  ProjectionRuntimeSettings,
} from "@/lib/projection";
import type { StochasticConfig, StochasticProjectionResult } from "@/lib/projection";

export interface CsvProjectionWorkerRequest {
  id: number;
  pack: CsvScenarioPack;
  projectionSettings: ProjectionRuntimeSettings;
  whatIfState: CsvScenarioWhatIfState;
}

export interface CsvProjectionWorkerResponse {
  id: number;
  result: CsvProjectionResult | null;
  runtimeError: string | null;
}

export interface StochasticWorkerRequest {
  id: number;
  pack: CsvScenarioPack;
  projectionSettings: ProjectionRuntimeSettings;
  whatIfState: CsvScenarioWhatIfState;
  config: StochasticConfig;
}

export interface StochasticWorkerProgress {
  id: number;
  progress: number;
  type: "progress";
}

export interface StochasticWorkerResponse {
  id: number;
  result: StochasticProjectionResult | null;
  runtimeError: string | null;
  type: "result";
}
