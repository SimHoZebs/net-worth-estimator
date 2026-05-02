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

  it("works without onProgress callback (backward compatible)", () => {
    const { data: pack } = parseCsvScenarioPack(validCsvFiles);
    expect(pack).not.toBeNull();

    const result = stochasticProject(
      pack!,
      { targetNetWorth: 1_000_000, fallbackProjectionStartDate: "2026-04-01", horizonYears: 5 },
      { addedAccounts: [], addedPostings: [], addedCheckpoints: [], disabledAccountIds: [], disabledPostingIds: [] },
      { runCount: 50, seed: 42 }
    );

    expect(result.bands.length).toBeGreaterThan(0);
    expect(result.milestones.hitTargetProbability).toBeGreaterThanOrEqual(0);
  });

  it("returns P50 close to deterministic when volatility is zero", () => {
    const { data: pack } = parseCsvScenarioPack(validCsvFiles);
    expect(pack).not.toBeNull();

    const deterministicOnlyPack = {
      ...pack!,
      postings: pack!.postings.map((p) => ({ ...p, volatility: 0 })),
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

describe("stochastic progress streaming", () => {
  it("reports progress with ascending values and reaches 1.0", () => {
    const { data: pack } = parseCsvScenarioPack(validCsvFiles);
    expect(pack).not.toBeNull();

    const progressValues: number[] = [];
    stochasticProject(
      pack!,
      { targetNetWorth: 1_000_000, fallbackProjectionStartDate: "2026-04-01", horizonYears: 10 },
      { addedAccounts: [], addedPostings: [], addedCheckpoints: [], disabledAccountIds: [], disabledPostingIds: [] },
      { runCount: 250, seed: 42 },
      (p) => progressValues.push(p)
    );

    expect(progressValues.length).toBeGreaterThan(1);
    expect(progressValues[0]).toBeLessThan(1);
    expect(progressValues[progressValues.length - 1]).toBe(1);

    for (let i = 1; i < progressValues.length; i++) {
      expect(progressValues[i]).toBeGreaterThan(progressValues[i - 1]);
    }
  });

  it("produces identical results with and without onProgress", () => {
    const { data: pack } = parseCsvScenarioPack(validCsvFiles);
    expect(pack).not.toBeNull();

    const resultWithout = stochasticProject(
      pack!,
      { targetNetWorth: 1_000_000, fallbackProjectionStartDate: "2026-04-01", horizonYears: 10 },
      { addedAccounts: [], addedPostings: [], addedCheckpoints: [], disabledAccountIds: [], disabledPostingIds: [] },
      { runCount: 100, seed: 42 }
    );

    const resultWith = stochasticProject(
      pack!,
      { targetNetWorth: 1_000_000, fallbackProjectionStartDate: "2026-04-01", horizonYears: 10 },
      { addedAccounts: [], addedPostings: [], addedCheckpoints: [], disabledAccountIds: [], disabledPostingIds: [] },
      { runCount: 100, seed: 42 },
      () => {}
    );

    expect(resultWith.bands.length).toBe(resultWithout.bands.length);
    expect(resultWith.bands[0].netWorth.p50).toBe(resultWithout.bands[0].netWorth.p50);
    expect(resultWith.milestones.hitTargetProbability).toBe(resultWithout.milestones.hitTargetProbability);
  });

  it("reports progress for a small run count (1)", () => {
    const { data: pack } = parseCsvScenarioPack(validCsvFiles);
    expect(pack).not.toBeNull();

    const progressValues: number[] = [];
    stochasticProject(
      pack!,
      { targetNetWorth: 1_000_000, fallbackProjectionStartDate: "2026-04-01", horizonYears: 5 },
      { addedAccounts: [], addedPostings: [], addedCheckpoints: [], disabledAccountIds: [], disabledPostingIds: [] },
      { runCount: 1, seed: 42 },
      (p) => progressValues.push(p)
    );

    expect(progressValues.length).toBe(1);
    expect(progressValues[0]).toBe(1);
  });

  it("reports progress at expected batch boundaries", () => {
    const { data: pack } = parseCsvScenarioPack(validCsvFiles);
    expect(pack).not.toBeNull();

    const progressValues: number[] = [];
    stochasticProject(
      pack!,
      { targetNetWorth: 1_000_000, fallbackProjectionStartDate: "2026-04-01", horizonYears: 5 },
      { addedAccounts: [], addedPostings: [], addedCheckpoints: [], disabledAccountIds: [], disabledPostingIds: [] },
      { runCount: 100, seed: 42 },
      (p) => progressValues.push(p)
    );

    expect(progressValues).toEqual([1]);
  });

  it("reports multiple batches for count larger than batch size", () => {
    const { data: pack } = parseCsvScenarioPack(validCsvFiles);
    expect(pack).not.toBeNull();

    const progressValues: number[] = [];
    stochasticProject(
      pack!,
      { targetNetWorth: 1_000_000, fallbackProjectionStartDate: "2026-04-01", horizonYears: 5 },
      { addedAccounts: [], addedPostings: [], addedCheckpoints: [], disabledAccountIds: [], disabledPostingIds: [] },
      { runCount: 250, seed: 42 },
      (p) => progressValues.push(p)
    );

    expect(progressValues.length).toBe(3);
    expect(progressValues[0]).toBeCloseTo(100 / 250, 5);
    expect(progressValues[1]).toBeCloseTo(200 / 250, 5);
    expect(progressValues[2]).toBe(1);
  });
});
