import { useCallback, useMemo, useState } from "react";
import type { ScenarioWhatIfState } from "@/lib/projection";

const DEFAULT_MULTIPLIER = 1;

const initialState: ScenarioWhatIfState = {
  postingOverrides: {},
};

export function useWhatIfState() {
  const [state, setState] = useState<ScenarioWhatIfState>(initialState);

  const setPostingMultiplier = useCallback((postingId: string, multiplier: number) => {
    setState((current) => {
      if (Math.abs(multiplier - DEFAULT_MULTIPLIER) < 0.0001) {
        const { [postingId]: _ignored, ...remainingOverrides } = current.postingOverrides;
        return { postingOverrides: remainingOverrides };
      }

      return {
        postingOverrides: {
          ...current.postingOverrides,
          [postingId]: {
            postingId,
            mode: "multiplier",
            value: multiplier,
          },
        },
      };
    });
  }, []);

  const clearPostingOverride = useCallback((postingId: string) => {
    setState((current) => {
      const { [postingId]: _ignored, ...remainingOverrides } = current.postingOverrides;
      return { postingOverrides: remainingOverrides };
    });
  }, []);

  const resetAllOverrides = useCallback(() => {
    setState(initialState);
  }, []);

  const activeOverrideCount = useMemo(
    () => Object.keys(state.postingOverrides).length,
    [state.postingOverrides]
  );

  return {
    state,
    activeOverrideCount,
    setPostingMultiplier,
    clearPostingOverride,
    resetAllOverrides,
  };
}
