import { startTransition, useCallback, useEffect, useReducer, useState } from "react";
import {
  DEFAULT_SCENARIO,
  loadStoredScenario,
  parseScenarioDocument,
  serializeScenarioDocument,
  setScenarioValue,
  writeStoredScenario,
} from "../lib/projection";
import type { ProjectionScenario, ScenarioPath } from "../lib/projection";

type ScenarioAction =
  | { type: "update"; path: ScenarioPath; value: unknown }
  | { type: "replace"; scenario: ProjectionScenario }
  | { type: "reset" };

function getBrowserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function scenarioReducer(state: ProjectionScenario, action: ScenarioAction): ProjectionScenario {
  switch (action.type) {
    case "update":
      return setScenarioValue(state, action.path, action.value);
    case "replace":
      return action.scenario;
    case "reset":
      return DEFAULT_SCENARIO;
    default:
      return state;
  }
}

export function useProjectionScenario() {
  const [scenario, dispatch] = useReducer(scenarioReducer, DEFAULT_SCENARIO, () => loadStoredScenario(getBrowserStorage()));
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    writeStoredScenario(getBrowserStorage(), scenario);
  }, [scenario]);

  const updateField = useCallback((path: ScenarioPath, value: unknown) => {
    setImportError(null);
    startTransition(() => {
      dispatch({ type: "update", path, value });
    });
  }, []);

  const resetScenario = useCallback(() => {
    setImportError(null);
    startTransition(() => {
      dispatch({ type: "reset" });
    });
  }, []);

  const importScenario = useCallback((serializedScenario: string) => {
    try {
      const nextScenario = parseScenarioDocument(serializedScenario);
      setImportError(null);
      startTransition(() => {
        dispatch({ type: "replace", scenario: nextScenario });
      });
      return true;
    } catch {
      setImportError("Could not import scenario JSON.");
      return false;
    }
  }, []);

  const exportScenario = useCallback(() => serializeScenarioDocument(scenario), [scenario]);

  return {
    scenario,
    importError,
    updateField,
    resetScenario,
    importScenario,
    exportScenario,
  };
}
