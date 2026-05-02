import { useCallback, useEffect, useRef, useState } from "react";
import type { DataSource } from "@/lib/projection/dataSource";
import type { ScenarioPack, ScenarioValidationIssue } from "@/lib/projection";

interface ScenarioPackState {
  pack: ScenarioPack | null;
  issues: ScenarioValidationIssue[];
  loadError: string | null;
  isLoading: boolean;
  loadedAt: Date | null;
}

const initialState: ScenarioPackState = {
  pack: null,
  issues: [],
  loadError: null,
  isLoading: true,
  loadedAt: null,
};

export function useScenarioPack(dataSource: DataSource) {
  const requestIdRef = useRef(0);
  const [state, setState] = useState<ScenarioPackState>(initialState);

  const reload = useCallback(async () => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;

    setState((current) => ({
      ...current,
      isLoading: true,
      loadError: null,
    }));

    try {
      const result = await dataSource.loadPack();

      if (requestId !== requestIdRef.current) {
        return;
      }

      setState({
        pack: result.pack,
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
        loadError: error instanceof Error ? error.message : "Could not load data files.",
        isLoading: false,
        loadedAt: null,
      });
    }
  }, [dataSource]);

  useEffect(() => {
    void reload();
  }, [reload]);

  return {
    ...state,
    reload,
  };
}
