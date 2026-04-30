import { DEFAULT_SCENARIO, DEFAULT_SCENARIO_DEFINITION } from "./scenarios";
import { buildProjectionInput } from "./normalize";
import { buildScenarioDefinition } from "./scenarioBuilder";
import type { ProjectionScenario, ScenarioDefinition, ScenarioDocument } from "./types";

export const SCENARIO_DOCUMENT_VERSION = 2;
export const SCENARIO_STORAGE_KEY = "net-worth-estimator/scenario";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function coerceToTemplate<T>(candidate: unknown, template: T): T {
  if (typeof template === "number") {
    return (typeof candidate === "number" && Number.isFinite(candidate) ? candidate : template) as T;
  }

  if (typeof template === "boolean") {
    return (typeof candidate === "boolean" ? candidate : template) as T;
  }

  if (typeof template === "string") {
    return (typeof candidate === "string" ? candidate : template) as T;
  }

  if (Array.isArray(template)) {
    if (!Array.isArray(candidate)) return template;
    if (template.length === 0) return candidate as T;
    return candidate.map((item) => coerceToTemplate(item, template[0])) as T;
  }

  if (isPlainObject(template)) {
    const source = isPlainObject(candidate) ? candidate : {};
    const next: Record<string, unknown> = {};

    Object.keys(template).forEach((key) => {
      next[key] = coerceToTemplate(source[key], template[key as keyof typeof template]);
    });

    return next as T;
  }

  return template;
}

function looksLikeScenarioDefinition(candidate: unknown): candidate is ScenarioDefinition {
  return isPlainObject(candidate) && Array.isArray(candidate.accounts) && Array.isArray(candidate.modules);
}

function migrateLegacyScenario(legacyScenario: ProjectionScenario): ScenarioDefinition {
  return buildScenarioDefinition(buildProjectionInput(legacyScenario));
}

export function createScenarioDocument(scenario: ScenarioDefinition): ScenarioDocument {
  return {
    version: SCENARIO_DOCUMENT_VERSION,
    exportedAt: new Date().toISOString(),
    scenario,
  };
}

export function serializeScenarioDocument(scenario: ScenarioDefinition): string {
  return JSON.stringify(createScenarioDocument(scenario), null, 2);
}

export function parseScenarioData(data: unknown): ScenarioDefinition {
  const candidate = isPlainObject(data) && isPlainObject(data.scenario)
    ? data.scenario
    : data;

  if (looksLikeScenarioDefinition(candidate)) {
    return candidate as ScenarioDefinition;
  }

  return migrateLegacyScenario(coerceToTemplate(candidate, DEFAULT_SCENARIO));
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
    return DEFAULT_SCENARIO_DEFINITION;
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
