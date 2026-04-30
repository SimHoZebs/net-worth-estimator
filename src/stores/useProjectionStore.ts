import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DEFAULT_SCENARIO_DEFINITION, SCENARIO_STORAGE_KEY, parseScenarioDocument, serializeScenarioDocument } from "@/lib/projection";
import type { ScenarioDefinition } from "@/lib/projection";

const PROJECTION_STORE_KEY = "net-worth-estimator/scenario-store";

function cloneScenario(scenario: ScenarioDefinition): ScenarioDefinition {
  return structuredClone(scenario);
}

function resolveInitialScenario(): ScenarioDefinition {
  if (typeof window === "undefined") {
    return cloneScenario(DEFAULT_SCENARIO_DEFINITION);
  }

  try {
    const legacyScenario = window.localStorage.getItem(SCENARIO_STORAGE_KEY);
    return legacyScenario ? parseScenarioDocument(legacyScenario) : cloneScenario(DEFAULT_SCENARIO_DEFINITION);
  } catch {
    return cloneScenario(DEFAULT_SCENARIO_DEFINITION);
  }
}

interface ProjectionStoreState {
  scenario: ScenarioDefinition;
  scenarioRevision: number;
  importError: string | null;
  replaceScenario: (scenario: ScenarioDefinition) => void;
  syncScenario: (scenario: ScenarioDefinition) => void;
  resetScenario: () => void;
  importScenario: (serializedScenario: string) => boolean;
  exportScenario: () => string;
  clearImportError: () => void;
}

export const useProjectionStore = create<ProjectionStoreState>()(
  persist(
    (set, get) => ({
      scenario: resolveInitialScenario(),
      scenarioRevision: 0,
      importError: null,
      replaceScenario: (scenario) => set((state) => ({ scenario: cloneScenario(scenario), scenarioRevision: state.scenarioRevision + 1, importError: null })),
      syncScenario: (scenario) => set({ scenario: cloneScenario(scenario), importError: null }),
      resetScenario: () => set((state) => ({
        scenario: cloneScenario(DEFAULT_SCENARIO_DEFINITION),
        scenarioRevision: state.scenarioRevision + 1,
        importError: null,
      })),
      importScenario: (serializedScenario) => {
        try {
          const nextScenario = parseScenarioDocument(serializedScenario);
          set((state) => ({ scenario: nextScenario, scenarioRevision: state.scenarioRevision + 1, importError: null }));
          return true;
        } catch {
          set({ importError: "Could not import scenario JSON." });
          return false;
        }
      },
      exportScenario: () => serializeScenarioDocument(get().scenario),
      clearImportError: () => set({ importError: null }),
    }),
    {
      name: PROJECTION_STORE_KEY,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ scenario: state.scenario }),
    }
  )
);
