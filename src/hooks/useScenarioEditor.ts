import { useCallback, useState } from "react";
import type { Account, Checkpoint, Posting, ScenarioPack } from "@/lib/projection";

export interface UseScenarioEditorState {
  workingPack: ScenarioPack | null;
  isDirty: boolean;
  isEditing: boolean;
}

export function useScenarioEditor(canonicalPack: ScenarioPack | null) {
  const [state, setState] = useState<UseScenarioEditorState>({
    workingPack: null,
    isDirty: false,
    isEditing: false,
  });

  const startEditing = useCallback(() => {
    if (!canonicalPack) return;
    setState({
      workingPack: clonePack(canonicalPack),
      isDirty: false,
      isEditing: true,
    });
  }, [canonicalPack]);

  const cancelEditing = useCallback(() => {
    setState({ workingPack: null, isDirty: false, isEditing: false });
  }, []);

  const updateAccount = useCallback((id: string, changes: Partial<Account>) => {
    setState((current) => {
      if (!current.workingPack) return current;
      return {
        ...current,
        isDirty: true,
        workingPack: {
          ...current.workingPack,
          accounts: current.workingPack.accounts.map((a) =>
            a.id === id ? { ...a, ...changes } : a
          ),
        },
      };
    });
  }, []);

  const deleteAccount = useCallback((id: string) => {
    setState((current) => {
      if (!current.workingPack) return current;
      return {
        ...current,
        isDirty: true,
        workingPack: {
          ...current.workingPack,
          accounts: current.workingPack.accounts.filter((a) => a.id !== id),
        },
      };
    });
  }, []);

  const addAccount = useCallback((account: Account) => {
    setState((current) => {
      if (!current.workingPack) return current;
      return {
        ...current,
        isDirty: true,
        workingPack: {
          ...current.workingPack,
          accounts: [...current.workingPack.accounts, account],
        },
      };
    });
  }, []);

  const updatePosting = useCallback((id: string, changes: Partial<Posting>) => {
    setState((current) => {
      if (!current.workingPack) return current;
      return {
        ...current,
        isDirty: true,
        workingPack: {
          ...current.workingPack,
          postings: current.workingPack.postings.map((p) =>
            p.id === id ? { ...p, ...changes } : p
          ),
        },
      };
    });
  }, []);

  const deletePosting = useCallback((id: string) => {
    setState((current) => {
      if (!current.workingPack) return current;
      return {
        ...current,
        isDirty: true,
        workingPack: {
          ...current.workingPack,
          postings: current.workingPack.postings.filter((p) => p.id !== id),
        },
      };
    });
  }, []);

  const addPosting = useCallback((posting: Posting) => {
    setState((current) => {
      if (!current.workingPack) return current;
      return {
        ...current,
        isDirty: true,
        workingPack: {
          ...current.workingPack,
          postings: [...current.workingPack.postings, posting],
        },
      };
    });
  }, []);

  const addCheckpoint = useCallback((checkpoint: Checkpoint) => {
    setState((current) => {
      if (!current.workingPack) return current;
      return {
        ...current,
        isDirty: true,
        workingPack: {
          ...current.workingPack,
          checkpoints: [...current.workingPack.checkpoints, checkpoint],
        },
      };
    });
  }, []);

  const deleteCheckpoint = useCallback((index: number) => {
    setState((current) => {
      if (!current.workingPack) return current;
      return {
        ...current,
        isDirty: true,
        workingPack: {
          ...current.workingPack,
          checkpoints: current.workingPack.checkpoints.filter((_, i) => i !== index),
        },
      };
    });
  }, []);

  const updateCheckpoint = useCallback((index: number, changes: Partial<Checkpoint>) => {
    setState((current) => {
      if (!current.workingPack) return current;
      const next = [...current.workingPack.checkpoints];
      next[index] = { ...next[index], ...changes };
      return {
        ...current,
        isDirty: true,
        workingPack: { ...current.workingPack, checkpoints: next },
      };
    });
  }, []);

  const markSaved = useCallback(() => {
    setState((current) => ({
      ...current,
      isDirty: false,
      isEditing: false,
      workingPack: null,
    }));
  }, []);

  return {
    ...state,
    startEditing,
    cancelEditing,
    updateAccount,
    deleteAccount,
    addAccount,
    updatePosting,
    deletePosting,
    addPosting,
    addCheckpoint,
    deleteCheckpoint,
    updateCheckpoint,
    markSaved,
  };
}

function clonePack(pack: ScenarioPack): ScenarioPack {
  return {
    ...pack,
    accounts: pack.accounts.map((a) => ({ ...a })),
    checkpoints: pack.checkpoints.map((c) => ({ ...c })),
    postings: pack.postings.map((p) => ({ ...p, destinations: p.destinations ? [...p.destinations] : null })),
  };
}
