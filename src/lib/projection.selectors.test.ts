import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO, buildProjectionInput, project, selectDashboardModel, summarizeEventsByType } from "./projection";

describe("projection selectors", () => {
  it("flags capped extra contributions in the dashboard model", () => {
    const scenario = {
      ...DEFAULT_SCENARIO,
      strategy: {
        ...DEFAULT_SCENARIO.strategy,
        extraInvestmentPct: 100,
      },
    };
    const result = project(buildProjectionInput(scenario));
    const dashboard = selectDashboardModel(result, scenario);

    expect(dashboard.extraContributionIsCapped).toBe(true);
    expect(dashboard.chartLabelByKey.amazonStock).toBe("Amazon stock");
  });

  it("summarizes emitted event types", () => {
    const result = project(buildProjectionInput(DEFAULT_SCENARIO));
    const summary = summarizeEventsByType(result.events.all);

    expect(summary.length).toBeGreaterThan(0);
    expect(summary.some((row) => row.type === "ordinary_income")).toBe(true);
    expect(summary.some((row) => row.type === "expense")).toBe(true);
  });
});
