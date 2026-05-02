import { useEffect, useRef, useState } from "react";

export interface WorkerProjectionState<TResult> {
  result: TResult | null;
  runtimeError: string | null;
  isRunning: boolean;
  progress: number | null;
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
    progress: null,
  });

  useEffect(() => {
    const worker = new Worker(workerUrl, { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const payload = event.data as {
        id: number;
        type?: string;
        progress?: number;
        result?: TResult | null;
        runtimeError?: string | null;
      };
      if (payload.id !== requestIdRef.current) {
        return;
      }

      if (payload.type === "progress" && typeof payload.progress === "number") {
        setState((current) => ({
          ...current,
          progress: payload.progress!,
        }));
        return;
      }

      setState({
        result: payload.result ?? null,
        runtimeError: payload.runtimeError ?? null,
        isRunning: false,
        progress: null,
      });
    };

    worker.onerror = () => {
      setState({
        result: null,
        runtimeError: errorMessage,
        isRunning: false,
        progress: null,
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
          progress: null,
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
      progress: null,
    }));

    workerRef.current.postMessage(buildPayload(id));
  }, [enabled, resetOnDisable, clearResultOnStart, buildPayload]);

  return state;
}
