import type {
  ProjectionResult,
  ScenarioPack,
  ScenarioWhatIfState,
  ProjectionRuntimeSettings,
} from "@/lib/projection";
import type { StochasticConfig, StochasticProjectionResult } from "@/lib/projection";

export interface ProjectionWorkerRequest {
  id: number;
  pack: ScenarioPack;
  projectionSettings: ProjectionRuntimeSettings;
  whatIfState: ScenarioWhatIfState;
}

export interface ProjectionWorkerResponse {
  id: number;
  result: ProjectionResult | null;
  runtimeError: string | null;
}

export interface StochasticWorkerRequest {
  id: number;
  pack: ScenarioPack;
  projectionSettings: ProjectionRuntimeSettings;
  whatIfState: ScenarioWhatIfState;
  config: StochasticConfig;
}

export interface StochasticWorkerProgress {
  id: number;
  progress: number;
  type: "progress";
  partial?: StochasticProjectionResult;
}

export interface StochasticWorkerResponse {
  id: number;
  result: StochasticProjectionResult | null;
  runtimeError: string | null;
  type: "result";
}
