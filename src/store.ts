import { create } from "zustand";
import type { StateCreator } from "zustand";
import type { Account, Checkpoint, Posting, ScenarioPack, ScenarioWhatIfState, StochasticConfig } from "@/lib/projection";
import type { ScenarioValidationIssue } from "@/lib/projection";
import type { ScenarioParseResult } from "@/lib/projection/dataSource";

/* ------------------------------------------------------------------ */
/*  Scenario slice                                                     */
/* ------------------------------------------------------------------ */

interface ScenarioSlice {
  pack: ScenarioPack | null;
  issues: ScenarioValidationIssue[];
  loadError: string | null;
  isLoading: boolean;
  loadedAt: Date | null;
  beginFetch: () => void;
  completeFetch: (result: ScenarioParseResult) => void;
  recordFetchError: (message: string) => void;
}

const createScenarioSlice: StateCreator<AppStore, [], [], ScenarioSlice> = (set) => ({
  pack: null,
  issues: [],
  loadError: null,
  isLoading: false,
  loadedAt: null,

  beginFetch: () => set({ isLoading: true, loadError: null }),

  completeFetch: (result) =>
    set({
      pack: result.pack,
      issues: result.issues,
      loadError: null,
      isLoading: false,
      loadedAt: new Date(),
    }),

  recordFetchError: (message) =>
    set({ pack: null, issues: [], loadError: message, isLoading: false }),
});

/* ------------------------------------------------------------------ */
/*  What-if slice                                                      */
/* ------------------------------------------------------------------ */

const initialWhatIfState: ScenarioWhatIfState = {
  addedAccounts: [],
  addedPostings: [],
  addedCheckpoints: [],
  disabledAccountIds: [],
  disabledPostingIds: [],
};

interface WhatIfSlice extends ScenarioWhatIfState {
  addTemporaryAccount: (account: Account) => void;
  removeTemporaryAccount: (id: string) => void;
  addTemporaryPosting: (posting: Posting) => void;
  removeTemporaryPosting: (id: string) => void;
  addTemporaryCheckpoint: (checkpoint: Checkpoint) => void;
  removeTemporaryCheckpoint: (index: number) => void;
  toggleAccountDisabled: (id: string) => void;
  togglePostingDisabled: (id: string) => void;
  resetAllOverrides: () => void;
}

const createWhatIfSlice: StateCreator<AppStore, [], [], WhatIfSlice> = (set) => ({
  ...initialWhatIfState,

  addTemporaryAccount: (account) =>
    set((s) => ({ addedAccounts: [...s.addedAccounts, account] })),

  removeTemporaryAccount: (id) =>
    set((s) => ({ addedAccounts: s.addedAccounts.filter((a) => a.id !== id) })),

  addTemporaryPosting: (posting) =>
    set((s) => ({ addedPostings: [...s.addedPostings, posting] })),

  removeTemporaryPosting: (id) =>
    set((s) => ({ addedPostings: s.addedPostings.filter((p) => p.id !== id) })),

  addTemporaryCheckpoint: (checkpoint) =>
    set((s) => ({ addedCheckpoints: [...s.addedCheckpoints, checkpoint] })),

  removeTemporaryCheckpoint: (index) =>
    set((s) => ({ addedCheckpoints: s.addedCheckpoints.filter((_, i) => i !== index) })),

  toggleAccountDisabled: (id) =>
    set((s) => ({
      disabledAccountIds: s.disabledAccountIds.includes(id)
        ? s.disabledAccountIds.filter((did) => did !== id)
        : [...s.disabledAccountIds, id],
    })),

  togglePostingDisabled: (id) =>
    set((s) => ({
      disabledPostingIds: s.disabledPostingIds.includes(id)
        ? s.disabledPostingIds.filter((did) => did !== id)
        : [...s.disabledPostingIds, id],
    })),

  resetAllOverrides: () => set(initialWhatIfState),
});

/* ------------------------------------------------------------------ */
/*  Editor slice                                                       */
/* ------------------------------------------------------------------ */

interface EditorSlice {
  workingPack: ScenarioPack | null;
  isDirty: boolean;
  isEditing: boolean;
  startEditing: () => void;
  cancelEditing: () => void;
  updateAccount: (id: string, changes: Partial<Account>) => void;
  deleteAccount: (id: string) => void;
  addAccount: (account: Account) => void;
  updatePosting: (id: string, changes: Partial<Posting>) => void;
  deletePosting: (id: string) => void;
  addPosting: (posting: Posting) => void;
  addCheckpoint: (checkpoint: Checkpoint) => void;
  deleteCheckpoint: (index: number) => void;
  updateCheckpoint: (index: number, changes: Partial<Checkpoint>) => void;
}

const createEditorSlice: StateCreator<AppStore, [], [], EditorSlice> = (set, get) => ({
  workingPack: null,
  isDirty: false,
  isEditing: false,

  startEditing: () => {
    const canonical = get().pack;
    if (!canonical) return;
    set({
      workingPack: clonePack(canonical),
      isDirty: false,
      isEditing: true,
    });
  },

  cancelEditing: () =>
    set({ workingPack: null, isDirty: false, isEditing: false }),

  updateAccount: (id, changes) =>
    set((s) => {
      if (!s.workingPack) return s;
      return {
        isDirty: true,
        workingPack: {
          ...s.workingPack,
          accounts: s.workingPack.accounts.map((a) =>
            a.id === id ? { ...a, ...changes } : a,
          ),
        },
      };
    }),

  deleteAccount: (id) =>
    set((s) => {
      if (!s.workingPack) return s;
      return {
        isDirty: true,
        workingPack: {
          ...s.workingPack,
          accounts: s.workingPack.accounts.filter((a) => a.id !== id),
        },
      };
    }),

  addAccount: (account) =>
    set((s) => {
      if (!s.workingPack) return s;
      return {
        isDirty: true,
        workingPack: { ...s.workingPack, accounts: [...s.workingPack.accounts, account] },
      };
    }),

  updatePosting: (id, changes) =>
    set((s) => {
      if (!s.workingPack) return s;
      return {
        isDirty: true,
        workingPack: {
          ...s.workingPack,
          postings: s.workingPack.postings.map((p) =>
            p.id === id ? { ...p, ...changes } : p,
          ),
        },
      };
    }),

  deletePosting: (id) =>
    set((s) => {
      if (!s.workingPack) return s;
      return {
        isDirty: true,
        workingPack: {
          ...s.workingPack,
          postings: s.workingPack.postings.filter((p) => p.id !== id),
        },
      };
    }),

  addPosting: (posting) =>
    set((s) => {
      if (!s.workingPack) return s;
      return {
        isDirty: true,
        workingPack: { ...s.workingPack, postings: [...s.workingPack.postings, posting] },
      };
    }),

  addCheckpoint: (checkpoint) =>
    set((s) => {
      if (!s.workingPack) return s;
      return {
        isDirty: true,
        workingPack: {
          ...s.workingPack,
          checkpoints: [...s.workingPack.checkpoints, checkpoint],
        },
      };
    }),

  deleteCheckpoint: (index) =>
    set((s) => {
      if (!s.workingPack) return s;
      return {
        isDirty: true,
        workingPack: {
          ...s.workingPack,
          checkpoints: s.workingPack.checkpoints.filter((_, i) => i !== index),
        },
      };
    }),

  updateCheckpoint: (index, changes) =>
    set((s) => {
      if (!s.workingPack) return s;
      const next = [...s.workingPack.checkpoints];
      next[index] = { ...next[index], ...changes };
      return {
        isDirty: true,
        workingPack: { ...s.workingPack, checkpoints: next },
      };
    }),
});

/* ------------------------------------------------------------------ */
/*  Settings slice                                                     */
/* ------------------------------------------------------------------ */

const DEFAULT_TARGET_NET_WORTH = 1_000_000;
const DEFAULT_STOCHASTIC_RUN_COUNT = 1000;

interface SettingsSlice {
  targetNetWorthInput: string;
  setTargetNetWorthInput: (value: string) => void;
  stochasticEnabled: boolean;
  setStochasticEnabled: (enabled: boolean) => void;
  stochasticConfig: StochasticConfig;
  setStochasticConfig: (config: StochasticConfig) => void;
}

const createSettingsSlice: StateCreator<AppStore, [], [], SettingsSlice> = (set) => ({
  targetNetWorthInput: String(DEFAULT_TARGET_NET_WORTH),
  setTargetNetWorthInput: (value) => set({ targetNetWorthInput: value }),

  stochasticEnabled: false,
  setStochasticEnabled: (enabled) => set({ stochasticEnabled: enabled }),

  stochasticConfig: { runCount: DEFAULT_STOCHASTIC_RUN_COUNT, seed: null },
  setStochasticConfig: (config) => set({ stochasticConfig: config }),
});

/* ------------------------------------------------------------------ */
/*  Composed store                                                     */
/* ------------------------------------------------------------------ */

export type AppStore = ScenarioSlice & WhatIfSlice & EditorSlice & SettingsSlice;

export const useStore = create<AppStore>()((...args) => ({
  ...createScenarioSlice(...args),
  ...createWhatIfSlice(...args),
  ...createEditorSlice(...args),
  ...createSettingsSlice(...args),
}));

/* ------------------------------------------------------------------ */
/*  Selectors                                                          */
/* ------------------------------------------------------------------ */

export const selectActiveOverrideCount = (s: AppStore) =>
  s.addedAccounts.length +
  s.addedPostings.length +
  s.addedCheckpoints.length +
  s.disabledAccountIds.length +
  s.disabledPostingIds.length;

export const selectWhatIfState = (s: AppStore): ScenarioWhatIfState => ({
  addedAccounts: s.addedAccounts,
  addedPostings: s.addedPostings,
  addedCheckpoints: s.addedCheckpoints,
  disabledAccountIds: s.disabledAccountIds,
  disabledPostingIds: s.disabledPostingIds,
});

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function clonePack(pack: ScenarioPack): ScenarioPack {
  return {
    ...pack,
    accounts: pack.accounts.map((a) => ({ ...a })),
    checkpoints: pack.checkpoints.map((c) => ({ ...c })),
    postings: pack.postings.map((p) => ({
      ...p,
      destinations: p.destinations ? [...p.destinations] : null,
    })),
  };
}
