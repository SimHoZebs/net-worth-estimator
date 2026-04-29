import type { ProjectionScenario, ScenarioPath } from "./types";

export function getScenarioValue<T>(scenario: ProjectionScenario, path: ScenarioPath): T {
  return path.reduce<unknown>((current, segment) => (current as Record<string, unknown>)[segment], scenario) as T;
}

export function setScenarioValue(scenario: ProjectionScenario, path: ScenarioPath, value: unknown): ProjectionScenario {
  if (path.length === 0) return scenario;

  const updateNode = (node: unknown, remainingPath: ScenarioPath): unknown => {
    const [segment, ...rest] = remainingPath;

    if (segment === undefined) return value;
    if (rest.length === 0) {
      return {
        ...(node as Record<string, unknown>),
        [segment]: value,
      };
    }

    return {
      ...(node as Record<string, unknown>),
      [segment]: updateNode((node as Record<string, unknown>)[segment], rest),
    };
  };

  return updateNode(scenario, path) as ProjectionScenario;
}
