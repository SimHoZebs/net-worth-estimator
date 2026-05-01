import { useCallback, useMemo, useState } from "react";
import type { CsvScenarioWhatIfState } from "@/lib/projection";

const DEFAULT_MULTIPLIER = 1;

const initialState: CsvScenarioWhatIfState = {
  contributionPlanOverrides: {},
};

export function useCsvWhatIfState() {
  const [state, setState] = useState<CsvScenarioWhatIfState>(initialState);

  const setContributionMultiplier = useCallback((contributionPlanId: string, multiplier: number) => {
    setState((current) => {
      if (Math.abs(multiplier - DEFAULT_MULTIPLIER) < 0.0001) {
        const { [contributionPlanId]: _ignored, ...remainingOverrides } = current.contributionPlanOverrides;
        return { contributionPlanOverrides: remainingOverrides };
      }

      return {
        contributionPlanOverrides: {
          ...current.contributionPlanOverrides,
          [contributionPlanId]: {
            contributionPlanId,
            mode: "multiplier",
            value: multiplier,
          },
        },
      };
    });
  }, []);

  const clearContributionOverride = useCallback((contributionPlanId: string) => {
    setState((current) => {
      const { [contributionPlanId]: _ignored, ...remainingOverrides } = current.contributionPlanOverrides;
      return { contributionPlanOverrides: remainingOverrides };
    });
  }, []);

  const resetAllOverrides = useCallback(() => {
    setState(initialState);
  }, []);

  const activeOverrideCount = useMemo(
    () => Object.keys(state.contributionPlanOverrides).length,
    [state.contributionPlanOverrides]
  );

  return {
    state,
    activeOverrideCount,
    setContributionMultiplier,
    clearContributionOverride,
    resetAllOverrides,
  };
}
