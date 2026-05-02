import { useEffect, useRef, useState } from "react";

export interface WorkerProjectionState<TResult> {
  result: TResult | null;
  runtimeError: string | null;
  isRunning: boolean;
}

interface UseWorkerProjectionOptions<TResult> {
  workerUrl: URL;
  enabled: boolean;
  errorMessage: string;
  resetOnDisable: boolean;
  clearResultOnStart: boolean;
  buildPayload: (id: number) => Record<string, unknown>;
}

export function useWorkerProjection<TResult>({
  workerUrl,
  enabled,
  errorMessage,
  resetOnDisable,
  clearResultOnStart,
  buildPayload,
}: UseWorkerProjectionOptions<TResult>): WorkerProjectionState<TResult> {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [state, setState] = useState<WorkerProjectionState<TResult>>({
    result: null,
    runtimeError: null,
    isRunning: false,
  });

  useEffect(() => {
    const worker = new Worker(workerUrl, { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const payload = event.data as { id: number; result: TResult | null; runtimeError: string | null };
      if (payload.id !== requestIdRef.current) {
        return;
      }

      setState({
        result: payload.result,
        runtimeError: payload.runtimeError,
        isRunning: false,
      });
    };

    worker.onerror = () => {
      setState({
        result: null,
        runtimeError: errorMessage,
        isRunning: false,
      });
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [workerUrl, errorMessage]);

  useEffect(() => {
    if (!workerRef.current || !enabled) {
      if (resetOnDisable) {
        setState({
          result: null,
          runtimeError: null,
          isRunning: false,
        });
      }
      return;
    }

    const id = requestIdRef.current + 1;
    requestIdRef.current = id;

    setState((current) => ({
      ...current,
      runtimeError: null,
      result: clearResultOnStart ? null : current.result,
      isRunning: true,
    }));

    workerRef.current.postMessage(buildPayload(id));
  }, [enabled, resetOnDisable, clearResultOnStart, buildPayload]);

  return state;
}
