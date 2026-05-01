import { useEffect, useRef, useState } from "react";
import type { CsvProjectionResult, CsvScenarioPack, CsvScenarioWhatIfState, ProjectionRuntimeSettings } from "@/lib/projection";

interface CsvProjectionWorkerState {
  result: CsvProjectionResult | null;
  runtimeError: string | null;
  isProjecting: boolean;
}

const initialState: CsvProjectionWorkerState = {
  result: null,
  runtimeError: null,
  isProjecting: false,
};

export function useCsvProjectionWorker(
  pack: CsvScenarioPack | null,
  projectionSettings: ProjectionRuntimeSettings,
  whatIfState: CsvScenarioWhatIfState,
  enabled: boolean
) {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [state, setState] = useState<CsvProjectionWorkerState>(initialState);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/csvProjectionWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const payload = event.data as CsvProjectionWorkerState & { id: number };
      if (payload.id !== requestIdRef.current) {
        return;
      }

      setState({
        result: payload.result,
        runtimeError: payload.runtimeError,
        isProjecting: false,
      });
    };

    worker.onerror = () => {
      setState({
        result: null,
        runtimeError: "Projection worker crashed.",
        isProjecting: false,
      });
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!workerRef.current || !pack || !enabled) {
      setState({
        result: null,
        runtimeError: null,
        isProjecting: false,
      });
      return;
    }

    const id = requestIdRef.current + 1;
    requestIdRef.current = id;

    setState((current) => ({
      ...current,
      runtimeError: null,
      isProjecting: true,
    }));

    workerRef.current.postMessage({ id, pack, projectionSettings, whatIfState });
  }, [enabled, pack, projectionSettings, whatIfState]);

  return state;
}
