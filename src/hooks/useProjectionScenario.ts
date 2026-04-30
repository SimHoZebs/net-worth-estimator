import { useShallow } from "zustand/react/shallow";
import { useProjectionStore } from "@/stores/useProjectionStore";

export function useProjectionScenario() {
  return useProjectionStore(
    useShallow((state) => ({
      scenario: state.scenario,
      scenarioRevision: state.scenarioRevision,
      importError: state.importError,
      replaceScenario: state.replaceScenario,
      syncScenario: state.syncScenario,
      resetScenario: state.resetScenario,
      importScenario: state.importScenario,
      exportScenario: state.exportScenario,
      clearImportError: state.clearImportError,
    }))
  );
}
