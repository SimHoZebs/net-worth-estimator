import type { ScenarioPath } from "./types";

export function getScenarioValue<T>(scenario: unknown, path: ScenarioPath): T {
  return path.reduce<unknown>((current, segment) => {
    if (Array.isArray(current) && typeof segment === "number") {
      return current[segment];
    }

    return (current as Record<string, unknown>)[String(segment)];
  }, scenario) as T;
}

export function setScenarioValue<T>(scenario: T, path: ScenarioPath, value: unknown): T {
  if (path.length === 0) return scenario;

  const updateNode = (node: unknown, remainingPath: ScenarioPath): unknown => {
    const [segment, ...rest] = remainingPath;

    if (segment === undefined) return value;

    if (Array.isArray(node)) {
      const next = [...node];
      const index = typeof segment === "number" ? segment : Number(segment);

      if (rest.length === 0) {
        next[index] = value;
        return next;
      }

      next[index] = updateNode(next[index], rest);
      return next;
    }

    if (rest.length === 0) {
      return {
        ...(node as Record<string, unknown>),
        [String(segment)]: value,
      };
    }

    return {
      ...(node as Record<string, unknown>),
      [String(segment)]: updateNode((node as Record<string, unknown>)[String(segment)], rest),
    };
  };

  return updateNode(scenario, path) as T;
}
