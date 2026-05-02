import { useCallback, useMemo, useState } from "react";
import type { Account, Checkpoint, Posting, ScenarioWhatIfState } from "@/lib/projection";

const initialState: ScenarioWhatIfState = {
  addedAccounts: [],
  addedPostings: [],
  addedCheckpoints: [],
  disabledAccountIds: [],
  disabledPostingIds: [],
};

export function useWhatIfState() {
  const [state, setState] = useState<ScenarioWhatIfState>(initialState);

  const addTemporaryAccount = useCallback((account: Account) => {
    setState((current) => ({
      ...current,
      addedAccounts: [...current.addedAccounts, account],
    }));
  }, []);

  const removeTemporaryAccount = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      addedAccounts: current.addedAccounts.filter((a) => a.id !== id),
    }));
  }, []);

  const addTemporaryPosting = useCallback((posting: Posting) => {
    setState((current) => ({
      ...current,
      addedPostings: [...current.addedPostings, posting],
    }));
  }, []);

  const removeTemporaryPosting = useCallback((id: string) => {
    setState((current) => ({
      ...current,
      addedPostings: current.addedPostings.filter((p) => p.id !== id),
    }));
  }, []);

  const addTemporaryCheckpoint = useCallback((checkpoint: Checkpoint) => {
    setState((current) => ({
      ...current,
      addedCheckpoints: [...current.addedCheckpoints, checkpoint],
    }));
  }, []);

  const removeTemporaryCheckpoint = useCallback((index: number) => {
    setState((current) => ({
      ...current,
      addedCheckpoints: current.addedCheckpoints.filter((_, i) => i !== index),
    }));
  }, []);

  const toggleAccountDisabled = useCallback((id: string) => {
    setState((current) => {
      const alreadyDisabled = current.disabledAccountIds.includes(id);
      return {
        ...current,
        disabledAccountIds: alreadyDisabled
          ? current.disabledAccountIds.filter((did) => did !== id)
          : [...current.disabledAccountIds, id],
      };
    });
  }, []);

  const togglePostingDisabled = useCallback((id: string) => {
    setState((current) => {
      const alreadyDisabled = current.disabledPostingIds.includes(id);
      return {
        ...current,
        disabledPostingIds: alreadyDisabled
          ? current.disabledPostingIds.filter((did) => did !== id)
          : [...current.disabledPostingIds, id],
      };
    });
  }, []);

  const resetAllOverrides = useCallback(() => {
    setState(initialState);
  }, []);

  const activeOverrideCount = useMemo(
    () =>
      state.addedAccounts.length +
      state.addedPostings.length +
      state.addedCheckpoints.length +
      state.disabledAccountIds.length +
      state.disabledPostingIds.length,
    [
      state.addedAccounts,
      state.addedPostings,
      state.addedCheckpoints,
      state.disabledAccountIds,
      state.disabledPostingIds,
    ]
  );

  return {
    state,
    activeOverrideCount,
    addTemporaryAccount,
    removeTemporaryAccount,
    addTemporaryPosting,
    removeTemporaryPosting,
    addTemporaryCheckpoint,
    removeTemporaryCheckpoint,
    toggleAccountDisabled,
    togglePostingDisabled,
    resetAllOverrides,
  };
}
