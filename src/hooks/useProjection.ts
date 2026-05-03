import { useEffect, useState } from "react";
import { useProjectionEngine } from "@/engine/ProjectionEngineContext";
import type { ProjectionHookState } from "./types";
import type {
  ProjectionResult,
  ProjectionRuntimeSettings,
  ScenarioPack,
  ScenarioWhatIfState,
} from "@/lib/projection";

export type { ProjectionHookState };

export function useProjection(
  pack: ScenarioPack | null,
  projectionSettings: ProjectionRuntimeSettings,
  whatIfState: ScenarioWhatIfState,
  enabled: boolean,
): ProjectionHookState<ProjectionResult> {
  const engine = useProjectionEngine();
  const [state, setState] = useState<ProjectionHookState<ProjectionResult>>({
    result: null,
    runtimeError: null,
    isRunning: false,
    progress: null,
  });

  useEffect(() => {
    if (!enabled || pack === null) {
      setState({ result: null, runtimeError: null, isRunning: false, progress: null });
      return;
    }

    const controller = new AbortController();
    setState((s) => ({ ...s, isRunning: true, runtimeError: null }));

    engine
      .project({
        pack,
        projectionSettings,
        whatIfState,
        signal: controller.signal,
      })
      .then((result) => {
        setState({ result, runtimeError: null, isRunning: false, progress: null });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setState({
          result: null,
          runtimeError: err instanceof Error ? err.message : "Projection failed.",
          isRunning: false,
          progress: null,
        });
      });

    return () => {
      controller.abort();
    };
  }, [pack, projectionSettings, whatIfState, enabled, engine]);

  return state;
}
