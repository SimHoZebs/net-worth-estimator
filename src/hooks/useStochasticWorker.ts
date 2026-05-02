import { useCallback, useMemo } from "react";
import type {
  CsvScenarioPack,
  CsvScenarioWhatIfState,
  ProjectionRuntimeSettings,
} from "@/lib/projection";
import type { StochasticConfig, StochasticProjectionResult } from "@/lib/projection";
import { useWorkerProjection } from "./workerFoundation";
import type { WorkerProjectionState } from "./workerFoundation";

export function useStochasticWorker(
  pack: CsvScenarioPack | null,
  projectionSettings: ProjectionRuntimeSettings,
  whatIfState: CsvScenarioWhatIfState,
  config: StochasticConfig | null,
  enabled: boolean
): WorkerProjectionState<StochasticProjectionResult> {
  const workerUrl = useMemo(
    () => new URL("../workers/stochasticWorker.ts", import.meta.url),
    []
  );

  const buildPayload = useCallback(
    (id: number) => ({ id, pack, projectionSettings, whatIfState, config }),
    [pack, projectionSettings, whatIfState, config]
  );

  return useWorkerProjection<StochasticProjectionResult>({
    workerUrl,
    enabled: enabled && pack !== null && config !== null,
    errorMessage: "Stochastic worker crashed.",
    resetOnDisable: false,
    clearResultOnStart: true,
    buildPayload,
  });
}
