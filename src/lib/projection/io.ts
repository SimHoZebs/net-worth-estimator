import { DEFAULT_SCENARIO_DEFINITION } from "./scenarios";
import type { ScenarioDefinition, ScenarioDocument } from "./types";
import { scenarioDefinitionSchema, scenarioDocumentSchema } from "./schema";

export const SCENARIO_DOCUMENT_VERSION = 2;
export const SCENARIO_STORAGE_KEY = "net-worth-estimator/scenario";

function cloneScenario(scenario: ScenarioDefinition): ScenarioDefinition {
  return structuredClone(scenario);
}

export function createScenarioDocument(scenario: ScenarioDefinition): ScenarioDocument {
  return {
    version: SCENARIO_DOCUMENT_VERSION,
    exportedAt: new Date().toISOString(),
    scenario: cloneScenario(scenario),
  };
}

export function serializeScenarioDocument(scenario: ScenarioDefinition): string {
  return JSON.stringify(createScenarioDocument(scenario), null, 2);
}

export function parseScenarioData(data: unknown): ScenarioDefinition {
  const documentResult = scenarioDocumentSchema.safeParse(data);
  if (documentResult.success) {
    return documentResult.data.scenario;
  }

  return scenarioDefinitionSchema.parse(data);
}

export function parseScenarioDocument(serializedScenario: string): ScenarioDefinition {
  return parseScenarioData(JSON.parse(serializedScenario));
}

export function loadStoredScenario(storage: Storage | null): ScenarioDefinition {
  if (!storage) return DEFAULT_SCENARIO_DEFINITION;

  try {
    const stored = storage.getItem(SCENARIO_STORAGE_KEY);
    return stored ? parseScenarioDocument(stored) : DEFAULT_SCENARIO_DEFINITION;
  } catch {
    return cloneScenario(DEFAULT_SCENARIO_DEFINITION);
  }
}

export function writeStoredScenario(storage: Storage | null, scenario: ScenarioDefinition): void {
  if (!storage) return;

  try {
    storage.setItem(SCENARIO_STORAGE_KEY, serializeScenarioDocument(scenario));
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}
