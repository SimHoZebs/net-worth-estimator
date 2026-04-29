import { describe, expect, it } from "vitest";
import { DEFAULT_SCENARIO_DEFINITION, project, selectDashboardModel, summarizeEventsByType } from "./projection";

describe("projection selectors", () => {
  it("builds a generic dashboard model from dynamic accounts", () => {
    const result = project(DEFAULT_SCENARIO_DEFINITION);
    const dashboard = selectDashboardModel(result, DEFAULT_SCENARIO_DEFINITION);

    expect(dashboard.totalAccounts).toBe(DEFAULT_SCENARIO_DEFINITION.accounts.length);
    expect(dashboard.totalModules).toBe(DEFAULT_SCENARIO_DEFINITION.modules.length);
    expect(dashboard.accountLabelsById.amazonStock).toBe("Amazon stock");
    expect(dashboard.assetAccountIds).toContain("k401");
    expect(dashboard.liabilityAccountIds).toContain("studentLoan");
  });

  it("summarizes emitted event types", () => {
    const result = project(DEFAULT_SCENARIO_DEFINITION);
    const summary = summarizeEventsByType(result.events.all);

    expect(summary.length).toBeGreaterThan(0);
    expect(summary.some((row) => row.type === "ordinary_income")).toBe(true);
    expect(summary.some((row) => row.type === "expense")).toBe(true);
  });
});
