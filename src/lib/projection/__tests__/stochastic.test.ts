import { describe, expect, it } from "vitest";
import {
  computePercentiles,
  parseCsvScenarioPack,
  projectScenarioPack,
  reseed,
  sampleLogNormal,
  stochasticProject,
} from "../";
import { validCsvFiles } from "../__fixtures__";

describe("stochastic utilities", () => {
  it("computes correct percentiles", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const percentiles = computePercentiles(values);

    expect(percentiles.p10).toBe(1.9);
    expect(percentiles.p25).toBe(3.25);
    expect(percentiles.p50).toBe(5.5);
    expect(percentiles.p75).toBe(7.75);
    expect(percentiles.p90).toBe(9.1);
  });

  it("handles empty percentile input", () => {
    const percentiles = computePercentiles([]);

    expect(percentiles.p10).toBe(0);
    expect(percentiles.p50).toBe(0);
  });

  it("returns expected return when volatility is zero", () => {
    expect(sampleLogNormal(0.07, 0)).toBe(0.07);
  });

  it("is deterministic with a seed", () => {
    reseed(42);
    const first = sampleLogNormal(0.07, 0.15);
    reseed(42);
    const second = sampleLogNormal(0.07, 0.15);

    expect(first).toBe(second);
    expect(first).not.toBe(0.07);
  });

  it("produces different draws without seed", () => {
    reseed(null);
    const first = sampleLogNormal(0.07, 0.15);
    const second = sampleLogNormal(0.07, 0.15);

    expect(first).not.toBe(second);
  });
});

describe("stochastic projection", () => {
  it("returns deterministic baseline alongside stochastic bands", () => {
    const { data: pack } = parseCsvScenarioPack(validCsvFiles);
    expect(pack).not.toBeNull();

    const result = stochasticProject(
      pack!,
      { targetNetWorth: 1_000_000, fallbackProjectionStartDate: "2026-04-01", horizonYears: 10 },
      { addedAccounts: [], addedPostings: [], addedCheckpoints: [], disabledAccountIds: [], disabledPostingIds: [] },
      { runCount: 100, seed: 42 }
    );

    expect(result.deterministic).toBeDefined();
    expect(result.bands.length).toBeGreaterThan(0);
    expect(result.config.runCount).toBe(100);
    expect(result.milestones.hitTargetProbability).toBeGreaterThanOrEqual(0);
    expect(result.milestones.hitTargetProbability).toBeLessThanOrEqual(1);
  });

  it("generates same bands with same seed", () => {
    const { data: pack } = parseCsvScenarioPack(validCsvFiles);
    expect(pack).not.toBeNull();

    const result1 = stochasticProject(
      pack!,
      { targetNetWorth: 1_000_000, fallbackProjectionStartDate: "2026-04-01", horizonYears: 10 },
      { addedAccounts: [], addedPostings: [], addedCheckpoints: [], disabledAccountIds: [], disabledPostingIds: [] },
      { runCount: 100, seed: 42 }
    );

    const result2 = stochasticProject(
      pack!,
      { targetNetWorth: 1_000_000, fallbackProjectionStartDate: "2026-04-01", horizonYears: 10 },
      { addedAccounts: [], addedPostings: [], addedCheckpoints: [], disabledAccountIds: [], disabledPostingIds: [] },
      { runCount: 100, seed: 42 }
    );

    expect(result1.bands.length).toBe(result2.bands.length);
    expect(result1.bands[0].netWorth.p50).toBe(result2.bands[0].netWorth.p50);
    expect(result1.milestones.hitTargetProbability).toBe(result2.milestones.hitTargetProbability);
  });

  it("returns P50 close to deterministic when volatility is zero", () => {
    const { data: pack } = parseCsvScenarioPack(validCsvFiles);
    expect(pack).not.toBeNull();

    const deterministicOnlyPack = {
      ...pack!,
      accounts: pack!.accounts.map((a) => ({ ...a, volatility: 0 })),
    };

    const result = stochasticProject(
      deterministicOnlyPack,
      { targetNetWorth: 1_000_000, fallbackProjectionStartDate: "2026-04-01", horizonYears: 10 },
      { addedAccounts: [], addedPostings: [], addedCheckpoints: [], disabledAccountIds: [], disabledPostingIds: [] },
      { runCount: 100, seed: 42 }
    );

    const deterministic = projectScenarioPack(
      deterministicOnlyPack,
      { targetNetWorth: 1_000_000, fallbackProjectionStartDate: "2026-04-01", horizonYears: 10 },
      { addedAccounts: [], addedPostings: [], addedCheckpoints: [], disabledAccountIds: [], disabledPostingIds: [] }
    );

    expect(result.bands[result.bands.length - 1].netWorth.p50).toBe(
      deterministic.timeline.rows[deterministic.timeline.rows.length - 1].netWorth
    );
  });
});
