import { useCallback, useMemo } from "react";
import type { ProjectionResult, ScenarioPack, ScenarioWhatIfState, ProjectionRuntimeSettings } from "@/lib/projection";
import { useWorkerProjection } from "./workerFoundation";
import type { WorkerProjectionState } from "./workerFoundation";

export function useProjectionWorker(
  pack: ScenarioPack | null,
  projectionSettings: ProjectionRuntimeSettings,
  whatIfState: ScenarioWhatIfState,
  enabled: boolean
): WorkerProjectionState<ProjectionResult> {
  const workerUrl = useMemo(
    () => new URL("../workers/projectionWorker.ts", import.meta.url),
    []
  );

  const buildPayload = useCallback(
    (id: number) => ({ id, pack, projectionSettings, whatIfState }),
    [pack, projectionSettings, whatIfState]
  );

  return useWorkerProjection<ProjectionResult>({
    workerUrl,
    enabled: enabled && pack !== null,
    errorMessage: "Projection worker crashed.",
    resetOnDisable: true,
    clearResultOnStart: false,
    buildPayload,
  });
}
