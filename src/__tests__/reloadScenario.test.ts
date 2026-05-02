import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ScenarioPack } from "@/lib/projection";

describe("reloadScenario", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("calls beginFetch and completeFetch on success", async () => {
    const samplePack = {
      version: 8 as const,
      sourcePath: "/scenario",
      accounts: [],
      checkpoints: [],
      postings: [],
    };

    const mockLoadPack = vi.fn().mockResolvedValue({ pack: samplePack, issues: [] });
    const mockDataSource = {
      sourceType: "csv" as const,
      loadPack: mockLoadPack,
      savePack: vi.fn(),
    };

    vi.doMock("@/lib/projection", () => ({
      createCsvDataSource: vi.fn(() => mockDataSource),
    }));

    const { useStore } = await import("@/store");
    const { reloadScenario } = await import("@/lib/reloadScenario");

    reloadScenario();
    expect(useStore.getState().isLoading).toBe(true);
    expect(useStore.getState().loadError).toBeNull();

    await vi.waitFor(() => {
      expect(useStore.getState().isLoading).toBe(false);
    });

    expect(useStore.getState().pack).toEqual(samplePack);
    expect(useStore.getState().loadedAt).toBeInstanceOf(Date);
  });

  it("calls beginFetch and recordFetchError on failure", async () => {
    const mockLoadPack = vi.fn().mockRejectedValue(new Error("boom"));
    const mockDataSource = {
      sourceType: "csv" as const,
      loadPack: mockLoadPack,
      savePack: vi.fn(),
    };

    vi.doMock("@/lib/projection", () => ({
      createCsvDataSource: vi.fn(() => mockDataSource),
    }));

    const { useStore } = await import("@/store");
    const { reloadScenario } = await import("@/lib/reloadScenario");

    reloadScenario();

    await vi.waitFor(() => {
      expect(useStore.getState().isLoading).toBe(false);
    });

    expect(useStore.getState().pack).toBeNull();
    expect(useStore.getState().loadError).toBe("boom");
  });

  it("ignores stale responses from rapid successive calls", async () => {
    let resolveFirst!: (value: { pack: ScenarioPack; issues: [] }) => void;
    let resolveLatest!: (value: { pack: ScenarioPack; issues: [] }) => void;

    const firstPack = {
      version: 8 as const,
      sourcePath: "/first",
      accounts: [],
      checkpoints: [],
      postings: [],
    };

    const latestPack = {
      version: 8 as const,
      sourcePath: "/latest",
      accounts: [],
      checkpoints: [],
      postings: [],
    };

    const mockLoadPack = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise<{ pack: ScenarioPack; issues: [] }>((r) => { resolveFirst = r; }),
      )
      .mockImplementationOnce(
        () => new Promise<{ pack: ScenarioPack; issues: [] }>((r) => { resolveLatest = r; }),
      );

    const mockDataSource = {
      sourceType: "csv" as const,
      loadPack: mockLoadPack,
      savePack: vi.fn(),
    };

    vi.doMock("@/lib/projection", () => ({
      createCsvDataSource: vi.fn(() => mockDataSource),
    }));

    const { useStore } = await import("@/store");
    const { reloadScenario } = await import("@/lib/reloadScenario");

    reloadScenario();
    reloadScenario();

    resolveLatest!({ pack: latestPack, issues: [] });
    await vi.waitFor(() => {
      expect(useStore.getState().pack?.sourcePath).toBe("/latest");
    });

    resolveFirst!({ pack: firstPack, issues: [] });
    await new Promise((r) => setTimeout(r, 10));
    expect(useStore.getState().pack?.sourcePath).toBe("/latest");
  });
});
