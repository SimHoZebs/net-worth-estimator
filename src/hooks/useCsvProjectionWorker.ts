import { useCallback, useMemo } from "react";
import type { CsvProjectionResult, CsvScenarioPack, CsvScenarioWhatIfState, ProjectionRuntimeSettings } from "@/lib/projection";
import { useWorkerProjection } from "./workerFoundation";
import type { WorkerProjectionState } from "./workerFoundation";

export function useCsvProjectionWorker(
  pack: CsvScenarioPack | null,
  projectionSettings: ProjectionRuntimeSettings,
  whatIfState: CsvScenarioWhatIfState,
  enabled: boolean
): WorkerProjectionState<CsvProjectionResult> {
  const workerUrl = useMemo(
    () => new URL("../workers/csvProjectionWorker.ts", import.meta.url),
    []
  );

  const buildPayload = useCallback(
    (id: number) => ({ id, pack, projectionSettings, whatIfState }),
    [pack, projectionSettings, whatIfState]
  );

  return useWorkerProjection<CsvProjectionResult>({
    workerUrl,
    enabled: enabled && pack !== null,
    errorMessage: "Projection worker crashed.",
    resetOnDisable: true,
    clearResultOnStart: false,
    buildPayload,
  });
}
