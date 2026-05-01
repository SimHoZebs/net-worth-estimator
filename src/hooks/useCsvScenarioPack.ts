import { useCallback, useEffect, useRef, useState } from "react";
import { loadCsvScenarioPack } from "@/lib/projection";
import type { CsvScenarioPack, ScenarioValidationIssue } from "@/lib/projection";

interface CsvScenarioPackState {
  pack: CsvScenarioPack | null;
  issues: ScenarioValidationIssue[];
  loadError: string | null;
  isLoading: boolean;
  loadedAt: Date | null;
}

const initialState: CsvScenarioPackState = {
  pack: null,
  issues: [],
  loadError: null,
  isLoading: true,
  loadedAt: null,
};

export function useCsvScenarioPack() {
  const requestIdRef = useRef(0);
  const [state, setState] = useState<CsvScenarioPackState>(initialState);

  const reload = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setState((current) => ({
      ...current,
      isLoading: true,
      loadError: null,
    }));

    try {
      const result = await loadCsvScenarioPack();

      if (requestId !== requestIdRef.current) {
        return;
      }

      setState({
        pack: result.data,
        issues: result.issues,
        loadError: null,
        isLoading: false,
        loadedAt: new Date(),
      });
    } catch (error) {
      if (requestId !== requestIdRef.current) {
        return;
      }

      setState({
        pack: null,
        issues: [],
        loadError: error instanceof Error ? error.message : "Could not load CSV data files.",
        isLoading: false,
        loadedAt: null,
      });
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    ...state,
    reload,
  };
}
