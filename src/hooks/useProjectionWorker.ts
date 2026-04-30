import { useEffect, useRef, useState } from "react";
import type { CheckpointEntry, DashboardViewModel, EventSummaryRow, ProjectionResult, ScenarioDefinition, ScenarioValidationIssue } from "@/lib/projection";

interface ProjectionWorkerState {
  validation: {
    issues: ScenarioValidationIssue[];
    errors: ScenarioValidationIssue[];
    warnings: ScenarioValidationIssue[];
    isValid: boolean;
  };
  result: ProjectionResult | null;
  dashboard: DashboardViewModel | null;
  eventSummary: EventSummaryRow[];
  runtimeError: string | null;
  isProjecting: boolean;
}

const initialState: ProjectionWorkerState = {
  validation: {
    issues: [],
    errors: [],
    warnings: [],
    isValid: true,
  },
  result: null,
  dashboard: null,
  eventSummary: [],
  runtimeError: null,
  isProjecting: true,
};

export function useProjectionWorker(scenario: ScenarioDefinition, checkpoints: CheckpointEntry[]) {
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const [state, setState] = useState<ProjectionWorkerState>(initialState);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/projectionWorker.ts", import.meta.url), { type: "module" });
    workerRef.current = worker;

    worker.onmessage = (event) => {
      const payload = event.data as Omit<ProjectionWorkerState, "isProjecting"> & { id: number };
      if (payload.id !== requestIdRef.current) return;

      setState({
        validation: payload.validation,
        result: payload.result,
        dashboard: payload.dashboard,
        eventSummary: payload.eventSummary,
        runtimeError: payload.runtimeError,
        isProjecting: false,
      });
    };

    worker.onerror = () => {
      setState((current) => ({
        ...current,
        result: null,
        dashboard: null,
        eventSummary: [],
        runtimeError: "Projection worker crashed.",
        isProjecting: false,
      }));
    };

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!workerRef.current) return;

    const id = requestIdRef.current + 1;
    requestIdRef.current = id;

    setState((current) => ({ ...current, isProjecting: true, runtimeError: null }));
    workerRef.current.postMessage({ id, scenario, checkpoints });
  }, [checkpoints, scenario]);

  return state;
}
