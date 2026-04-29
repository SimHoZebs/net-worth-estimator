import { startTransition, useCallback, useEffect, useState } from "react";
import {
  DEFAULT_SCENARIO_DEFINITION,
  loadStoredScenario,
  parseScenarioDocument,
  serializeScenarioDocument,
  setScenarioValue,
  writeStoredScenario,
} from "../lib/projection";
import type { ScenarioDefinition, ScenarioPath } from "../lib/projection";

function getBrowserStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function useProjectionScenario() {
  const [scenario, setScenario] = useState<ScenarioDefinition>(() => loadStoredScenario(getBrowserStorage()));
  const [importError, setImportError] = useState<string | null>(null);

  useEffect(() => {
    writeStoredScenario(getBrowserStorage(), scenario);
  }, [scenario]);

  const updateScenario = useCallback((updater: (current: ScenarioDefinition) => ScenarioDefinition) => {
    setImportError(null);
    startTransition(() => {
      setScenario((current) => updater(current));
    });
  }, []);

  const updateField = useCallback((path: ScenarioPath, value: unknown) => {
    updateScenario((current) => setScenarioValue(current, path, value));
  }, [updateScenario]);

  const resetScenario = useCallback(() => {
    setImportError(null);
    startTransition(() => {
      setScenario(DEFAULT_SCENARIO_DEFINITION);
    });
  }, []);

  const importScenario = useCallback((serializedScenario: string) => {
    try {
      const nextScenario = parseScenarioDocument(serializedScenario);
      setImportError(null);
      startTransition(() => {
        setScenario(nextScenario);
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
    updateScenario,
    resetScenario,
    importScenario,
    exportScenario,
  };
}
