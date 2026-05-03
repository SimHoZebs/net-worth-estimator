// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ProjectionEngineProvider,
  useProjectionEngine,
} from "@/engine/ProjectionEngineContext";
import type { ProjectionEngine } from "@/lib/projection/engine/ProjectionEngine";
import type { ProjectionResult, StochasticProjectionResult } from "@/lib/projection";
import { createBasePack, makeSettings } from "@/lib/projection/__fixtures__";
import { projectScenarioPack } from "@/lib/projection";
import { renderHook } from "@testing-library/react";
import { wrapperWithEngine } from "./test-helpers";

/* ------------------------------------------------------------------ */
/*  Helpers                                                             */
/* ------------------------------------------------------------------ */

function makeProjectionResult(): ProjectionResult {
  return projectScenarioPack(createBasePack(), makeSettings());
}

function makeDefaultWhatIf() {
  return {
    addedAccounts: [],
    addedPostings: [],
    addedCheckpoints: [],
    disabledAccountIds: [],
    disabledPostingIds: [],
  };
}

function makeMockEngine(overrides: Partial<ProjectionEngine> = {}): ProjectionEngine {
  return {
    project: vi.fn(async () => makeProjectionResult()),
    projectStochastic: vi.fn(async () => ({}) as StochasticProjectionResult),
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  Context tests                                                        */
/* ------------------------------------------------------------------ */

describe("ProjectionEngineContext", () => {
  it("throws when used outside a provider", () => {
    expect(() => {
      const { result } = renderHook(() => useProjectionEngine());
      void result.current;
    }).toThrow("useProjectionEngine must be used within a <ProjectionEngineProvider>");
  });

  it("returns the engine provided via context", () => {
    const engine = makeMockEngine();
    const { result } = renderHook(() => useProjectionEngine(), {
      wrapper: wrapperWithEngine(engine),
    });
    expect(result.current).toBe(engine);
  });
});

/* ------------------------------------------------------------------ */
/*  Mock engine project() tests                                        */
/* ------------------------------------------------------------------ */

describe("Mock engine project()", () => {
  let engine: ProjectionEngine & { project: ReturnType<typeof vi.fn>; projectStochastic: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    engine = makeMockEngine() as typeof engine;
  });

  it("calls project with correct arguments", async () => {
    const pack = createBasePack();
    const settings = makeSettings();
    const whatIf = makeDefaultWhatIf();

    const result = await engine.project({ pack, projectionSettings: settings, whatIfState: whatIf });

    expect(engine.project).toHaveBeenCalledOnce();
    expect(engine.project).toHaveBeenCalledWith({ pack, projectionSettings: settings, whatIfState: whatIf });
    expect(result.summary.currentNetWorth).toBe(1600);
  });

  it("passes AbortSignal through to the request", async () => {
    const controller = new AbortController();

    await engine.project({
      pack: createBasePack(),
      projectionSettings: makeSettings(),
      whatIfState: makeDefaultWhatIf(),
      signal: controller.signal,
    });

    const callArgs = engine.project.mock.calls[0][0];
    expect(callArgs.signal).toBeInstanceOf(AbortSignal);
    expect(callArgs.signal).toBe(controller.signal);
  });

  it("engine rejects when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    engine.project = vi.fn(async (request: { signal?: AbortSignal }) => {
      if (request.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return makeProjectionResult();
    });

    await expect(
      engine.project({
        pack: createBasePack(),
        projectionSettings: makeSettings(),
        whatIfState: makeDefaultWhatIf(),
        signal: controller.signal,
      }),
    ).rejects.toThrow("Aborted");

    expect(engine.project).toHaveBeenCalledTimes(1);
  });
});

/* ------------------------------------------------------------------ */
/*  Mock engine projectStochastic() tests                              */
/* ------------------------------------------------------------------ */

describe("Mock engine projectStochastic()", () => {
  let engine: ProjectionEngine & { project: ReturnType<typeof vi.fn>; projectStochastic: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    engine = makeMockEngine() as typeof engine;
  });

  it("calls projectStochastic with correct arguments", async () => {
    const pack = createBasePack();
    const settings = makeSettings();
    const whatIf = makeDefaultWhatIf();
    const config = { runCount: 10, seed: 42 as number | null };

    await engine.projectStochastic({ pack, projectionSettings: settings, whatIfState: whatIf, config });

    expect(engine.projectStochastic).toHaveBeenCalledOnce();
    const callArgs = engine.projectStochastic.mock.calls[0][0];
    expect(callArgs).toEqual({ pack, projectionSettings: settings, whatIfState: whatIf, config });
  });

  it("calls onProgress callback", async () => {
    const onProgress = vi.fn();

    engine.projectStochastic = vi.fn(async (_request, onProgress?: (p: number) => void) => {
      onProgress?.(0.5);
      onProgress?.(1.0);
      return {} as StochasticProjectionResult;
    });

    await engine.projectStochastic(
      {
        pack: createBasePack(),
        projectionSettings: makeSettings(),
        whatIfState: makeDefaultWhatIf(),
        config: { runCount: 10, seed: null },
      },
      onProgress,
    );

    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenNthCalledWith(1, 0.5);
    expect(onProgress).toHaveBeenNthCalledWith(2, 1.0);
  });

  it("aborts with AbortError when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    engine.projectStochastic = vi.fn(async (request: { signal?: AbortSignal }) => {
      if (request.signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return {} as StochasticProjectionResult;
    });

    await expect(
      engine.projectStochastic({
        pack: createBasePack(),
        projectionSettings: makeSettings(),
        whatIfState: makeDefaultWhatIf(),
        config: { runCount: 10, seed: null },
        signal: controller.signal,
      }),
    ).rejects.toThrow("Aborted");
  });
});

/* ------------------------------------------------------------------ */
/*  WorkerProjectionEngine contract validation                         */
/* ------------------------------------------------------------------ */

describe("WorkerProjectionEngine", () => {
  it("exports a class that satisfies ProjectionEngine", async () => {
    const mod = await import("@/engine/WorkerProjectionEngine");
    expect(mod.WorkerProjectionEngine).toBeDefined();
    const engine = new mod.WorkerProjectionEngine();
    expect(typeof engine.project).toBe("function");
    expect(typeof engine.projectStochastic).toBe("function");
  });
});
