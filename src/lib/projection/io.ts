import { DEFAULT_SCENARIO } from "./defaults";
import type { ProjectionScenario, ScenarioDocument } from "./types";

export const SCENARIO_DOCUMENT_VERSION = 1;
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

export function createScenarioDocument(scenario: ProjectionScenario): ScenarioDocument {
  return {
    version: SCENARIO_DOCUMENT_VERSION,
    exportedAt: new Date().toISOString(),
    scenario,
  };
}

export function serializeScenarioDocument(scenario: ProjectionScenario): string {
  return JSON.stringify(createScenarioDocument(scenario), null, 2);
}

export function parseScenarioData(data: unknown): ProjectionScenario {
  const candidate = isPlainObject(data) && isPlainObject(data.scenario)
    ? data.scenario
    : data;

  return coerceToTemplate(candidate, DEFAULT_SCENARIO);
}

export function parseScenarioDocument(serializedScenario: string): ProjectionScenario {
  return parseScenarioData(JSON.parse(serializedScenario));
}

export function loadStoredScenario(storage: Storage | null): ProjectionScenario {
  if (!storage) return DEFAULT_SCENARIO;

  try {
    const stored = storage.getItem(SCENARIO_STORAGE_KEY);
    return stored ? parseScenarioDocument(stored) : DEFAULT_SCENARIO;
  } catch {
    return DEFAULT_SCENARIO;
  }
}

export function writeStoredScenario(storage: Storage | null, scenario: ProjectionScenario): void {
  if (!storage) return;

  try {
    storage.setItem(SCENARIO_STORAGE_KEY, serializeScenarioDocument(scenario));
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}
