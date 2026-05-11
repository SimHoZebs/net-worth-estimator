import { describe, it, expect, beforeEach } from "vitest";
import { NO_FLOOR, NO_CEILING } from "@/lib/projection/constants";
import { useStore, selectActiveOverrideCount, selectWhatIfState } from "@/store";

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

function makeAccount(id = "a1", label = "Savings") {
  return { id, label, minBalance: NO_FLOOR, maxBalance: NO_CEILING, color: null, enabled: true };
}

function makePosting(id = "p1") {
  return {
    id, label: "Salary", sourceAccountId: null, destinations: null,
    arithmetic: "5000", frequency: "monthly" as const,
    annualRate: 0, annualGrowthRate: 0, volatility: 0,
    startDate: "2025-01-01", endDate: null, annualCap: null, priority: 1, enabled: true,
  };
}

function makeCheckpoint(date = "2025-01-01", accountId = "a1", balance = 1000) {
  return { Date: date, AccountId: accountId, Balance: balance };
}

function makeScenarioPack(): {
  version: 8;
  sourcePath: string;
  accounts: Array<{ id: string; label: string; minBalance: number; maxBalance: number; color: null; enabled: boolean }>;
  checkpoints: Array<{ Date: string; AccountId: string; Balance: number }>;
  postings: Array<{ id: string; label: string; sourceAccountId: null; destinations: null; arithmetic: string; frequency: "monthly"; annualRate: number; annualGrowthRate: number; volatility: number; startDate: string; endDate: null; annualCap: null; priority: number; enabled: boolean }>;
} {
  return {
    version: 8,
    sourcePath: "/scenario",
    accounts: [{ id: "a1", label: "Savings", minBalance: NO_FLOOR, maxBalance: NO_CEILING, color: null, enabled: true }],
    checkpoints: [{ Date: "2025-01-01", AccountId: "a1", Balance: 1000 }],
    postings: [makePosting("p1")],
  };
}

/* ------------------------------------------------------------------ */
/*  What-if slice tests                                                */
/* ------------------------------------------------------------------ */

describe("WhatIf slice", () => {
  beforeEach(() => {
    useStore.getState().resetAllOverrides();
  });

  it("adds a temporary account", () => {
    useStore.getState().addTemporaryAccount(makeAccount());
    expect(useStore.getState().addedAccounts).toHaveLength(1);
  });

  it("removes a temporary account by id", () => {
    useStore.getState().addTemporaryAccount(makeAccount("a1"));
    useStore.getState().addTemporaryAccount(makeAccount("a2"));
    useStore.getState().removeTemporaryAccount("a1");
    expect(useStore.getState().addedAccounts).toHaveLength(1);
    expect(useStore.getState().addedAccounts[0].id).toBe("a2");
  });

  it("adds a temporary posting", () => {
    useStore.getState().addTemporaryPosting(makePosting());
    expect(useStore.getState().addedPostings).toHaveLength(1);
  });

  it("removes a temporary posting by id", () => {
    useStore.getState().addTemporaryPosting(makePosting("p1"));
    useStore.getState().addTemporaryPosting(makePosting("p2"));
    useStore.getState().removeTemporaryPosting("p1");
    expect(useStore.getState().addedPostings).toHaveLength(1);
    expect(useStore.getState().addedPostings[0].id).toBe("p2");
  });

  it("adds a temporary checkpoint", () => {
    useStore.getState().addTemporaryCheckpoint(makeCheckpoint());
    expect(useStore.getState().addedCheckpoints).toHaveLength(1);
  });

  it("removes a temporary checkpoint by index", () => {
    useStore.getState().addTemporaryCheckpoint(makeCheckpoint("2025-01-01"));
    useStore.getState().addTemporaryCheckpoint(makeCheckpoint("2025-02-01"));
    useStore.getState().removeTemporaryCheckpoint(0);
    expect(useStore.getState().addedCheckpoints).toHaveLength(1);
    expect(useStore.getState().addedCheckpoints[0].Date).toBe("2025-02-01");
  });

  it("toggles account disabled state on and off", () => {
    useStore.getState().toggleAccountDisabled("a1");
    expect(useStore.getState().disabledAccountIds).toEqual(["a1"]);
    useStore.getState().toggleAccountDisabled("a1");
    expect(useStore.getState().disabledAccountIds).toEqual([]);
  });

  it("toggles posting disabled state on and off", () => {
    useStore.getState().togglePostingDisabled("p1");
    expect(useStore.getState().disabledPostingIds).toEqual(["p1"]);
    useStore.getState().togglePostingDisabled("p1");
    expect(useStore.getState().disabledPostingIds).toEqual([]);
  });

  it("supports multiple disabled accounts", () => {
    useStore.getState().toggleAccountDisabled("a1");
    useStore.getState().toggleAccountDisabled("a2");
    expect(useStore.getState().disabledAccountIds).toEqual(["a1", "a2"]);
  });

  it("resets all overrides to initial state", () => {
    useStore.getState().addTemporaryAccount(makeAccount());
    useStore.getState().addTemporaryPosting(makePosting());
    useStore.getState().addTemporaryCheckpoint(makeCheckpoint());
    useStore.getState().toggleAccountDisabled("a1");
    useStore.getState().togglePostingDisabled("p1");
    useStore.getState().resetAllOverrides();
    expect(useStore.getState().addedAccounts).toEqual([]);
    expect(useStore.getState().addedPostings).toEqual([]);
    expect(useStore.getState().addedCheckpoints).toEqual([]);
    expect(useStore.getState().disabledAccountIds).toEqual([]);
    expect(useStore.getState().disabledPostingIds).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/*  Selector tests                                                     */
/* ------------------------------------------------------------------ */

describe("Selectors", () => {
  it("selectActiveOverrideCount returns correct count", () => {
    useStore.getState().resetAllOverrides();
    useStore.getState().addTemporaryAccount(makeAccount());
    useStore.getState().addTemporaryAccount(makeAccount("a2", "Checking"));
    useStore.getState().addTemporaryPosting(makePosting());
    useStore.getState().toggleAccountDisabled("a1");
    expect(selectActiveOverrideCount(useStore.getState())).toBe(4);
  });

  it("selectWhatIfState returns a stable snapshot", () => {
    useStore.getState().resetAllOverrides();
    useStore.getState().addTemporaryAccount(makeAccount());
    useStore.getState().togglePostingDisabled("p1");
    const snapshot = selectWhatIfState(useStore.getState());
    expect(snapshot.addedAccounts).toHaveLength(1);
    expect(snapshot.disabledPostingIds).toEqual(["p1"]);
  });
});

/* ------------------------------------------------------------------ */
/*  Snapshot slice tests                                               */
/* ------------------------------------------------------------------ */

describe("Snapshot slice", () => {
  beforeEach(() => {
    useStore.getState().clearSnapshots();
    useStore.getState().resetAllOverrides();
  });

  it("stores only the current what-if state in snapshots", () => {
    useStore.getState().addTemporaryAccount(makeAccount());
    useStore.getState().addSnapshotFromCurrentScenario("Trial", {
      currentNetWorth: 100,
      finalNetWorth: 200,
      hitTargetDate: null,
      shortfallAmount: 0,
      overrideCount: 1,
    });

    const snapshot = useStore.getState().snapshots[0];
    expect(snapshot.label).toBe("Trial");
    expect(snapshot.whatIfState).toEqual(selectWhatIfState(useStore.getState()));
    expect(snapshot.whatIfState).not.toHaveProperty("setTargetNetWorth");
  });
});

/* ------------------------------------------------------------------ */
/*  Reference stability                                                */
/* ------------------------------------------------------------------ */

describe("Reference stability", () => {
  beforeEach(() => {
    useStore.getState().resetAllOverrides();
  });

  it("getState returns identical reference when state is unchanged", () => {
    const a = useStore.getState();
    const b = useStore.getState();
    expect(a).toBe(b);
  });

  it("addedAccounts array reference is stable when no mutations occur", () => {
    useStore.getState().addTemporaryAccount(makeAccount());
    const before = useStore.getState().addedAccounts;
    const after = useStore.getState().addedAccounts;
    expect(before).toBe(after);
  });

  it("addedAccounts array reference changes when a new account is added", () => {
    const before = useStore.getState().addedAccounts;
    useStore.getState().addTemporaryAccount(makeAccount());
    const after = useStore.getState().addedAccounts;
    expect(before).not.toBe(after);
  });

  it("selectActiveOverrideCount returns stable values for identical state", () => {
    const a = selectActiveOverrideCount(useStore.getState());
    const b = selectActiveOverrideCount(useStore.getState());
    expect(a).toBe(b);
  });

  it("selectWhatIfState creates new object each call (plain function, not memoized)", () => {
    // This is expected behaviour — memoization happens at the useShallow layer.
    const a = selectWhatIfState(useStore.getState());
    const b = selectWhatIfState(useStore.getState());
    expect(a).not.toBe(b);
    // ...but values should be deeply equal
    expect(a).toEqual(b);
  });
});

/* ------------------------------------------------------------------ */
/*  Editor slice tests                                                 */
/* ------------------------------------------------------------------ */

describe("Editor slice", () => {
  beforeEach(() => {
    useStore.getState().resetAllOverrides();
    useStore.getState().cancelEditing();
  });

  describe("no-op when workingPack is null", () => {
    it("updateAccount does nothing", () => {
      const before = useStore.getState();
      useStore.getState().updateAccount("a1", { label: "New" });
      expect(useStore.getState()).toEqual(before);
    });

    it("deleteAccount does nothing", () => {
      const before = useStore.getState();
      useStore.getState().deleteAccount("a1");
      expect(useStore.getState()).toEqual(before);
    });

    it("addAccount does nothing", () => {
      const before = useStore.getState();
      useStore.getState().addAccount(makeAccount());
      expect(useStore.getState()).toEqual(before);
    });

    it("updatePosting does nothing", () => {
      const before = useStore.getState();
      useStore.getState().updatePosting("p1", { label: "New" });
      expect(useStore.getState()).toEqual(before);
    });

    it("deletePosting does nothing", () => {
      const before = useStore.getState();
      useStore.getState().deletePosting("p1");
      expect(useStore.getState()).toEqual(before);
    });

    it("addPosting does nothing", () => {
      const before = useStore.getState();
      useStore.getState().addPosting(makePosting());
      expect(useStore.getState()).toEqual(before);
    });

    it("addCheckpoint does nothing", () => {
      const before = useStore.getState();
      useStore.getState().addCheckpoint(makeCheckpoint());
      expect(useStore.getState()).toEqual(before);
    });

    it("deleteCheckpoint does nothing", () => {
      const before = useStore.getState();
      useStore.getState().deleteCheckpoint(0);
      expect(useStore.getState()).toEqual(before);
    });

    it("updateCheckpoint does nothing", () => {
      const before = useStore.getState();
      useStore.getState().updateCheckpoint(0, { Balance: 999 });
      expect(useStore.getState()).toEqual(before);
    });
  });

  describe("with a canonical pack", () => {
    const pack = makeScenarioPack();

    it("startEditing clones the pack and sets isEditing", () => {
      useStore.getState().startEditing(pack);
      expect(useStore.getState().isEditing).toBe(true);
      expect(useStore.getState().isDirty).toBe(false);
      expect(useStore.getState().workingPack).toEqual(pack);
      expect(useStore.getState().workingPack).not.toBe(pack);
    });

    it("cancelEditing resets state", () => {
      useStore.getState().startEditing(pack);
      useStore.getState().cancelEditing();
      expect(useStore.getState().isEditing).toBe(false);
      expect(useStore.getState().workingPack).toBeNull();
    });

    it("updateAccount modifies workingPack and sets isDirty", () => {
      useStore.getState().startEditing(pack);
      useStore.getState().updateAccount("a1", { label: "Investment" });
      expect(useStore.getState().isDirty).toBe(true);
      expect(useStore.getState().workingPack?.accounts[0].label).toBe("Investment");
    });

    it("deleteAccount removes from workingPack", () => {
      useStore.getState().startEditing(pack);
      useStore.getState().deleteAccount("a1");
      expect(useStore.getState().workingPack?.accounts).toHaveLength(0);
    });

    it("addAccount appends to workingPack", () => {
      useStore.getState().startEditing(pack);
      useStore.getState().addAccount(makeAccount("a2", "Checking"));
      expect(useStore.getState().workingPack?.accounts).toHaveLength(2);
    });

    it("updatePosting modifies posting in workingPack", () => {
      useStore.getState().startEditing(pack);
      useStore.getState().updatePosting("p1", { annualRate: 10000 });
      expect(useStore.getState().isDirty).toBe(true);
      expect(useStore.getState().workingPack?.postings[0].annualRate).toBe(10000);
    });

    it("deletePosting removes from workingPack", () => {
      useStore.getState().startEditing(pack);
      useStore.getState().deletePosting("p1");
      expect(useStore.getState().workingPack?.postings).toHaveLength(0);
    });

    it("addPosting appends to workingPack", () => {
      useStore.getState().startEditing(pack);
      useStore.getState().addPosting(makePosting("p2"));
      expect(useStore.getState().workingPack?.postings).toHaveLength(2);
    });

    it("addCheckpoint appends to workingPack", () => {
      useStore.getState().startEditing(pack);
      useStore.getState().addCheckpoint(makeCheckpoint("2025-03-01", "a1", 2000));
      expect(useStore.getState().workingPack?.checkpoints).toHaveLength(2);
    });

    it("deleteCheckpoint removes by index from workingPack", () => {
      useStore.getState().startEditing(pack);
      useStore.getState().deleteCheckpoint(0);
      expect(useStore.getState().workingPack?.checkpoints).toHaveLength(0);
    });

    it("updateCheckpoint modifies checkpoint in workingPack", () => {
      useStore.getState().startEditing(pack);
      useStore.getState().updateCheckpoint(0, { Balance: 9999 });
      expect(useStore.getState().workingPack?.checkpoints[0].Balance).toBe(9999);
    });
  });
});

/* ------------------------------------------------------------------ */
/*  Settings slice tests                                               */
/* ------------------------------------------------------------------ */

describe("Settings slice", () => {
  it("setTargetNetWorth updates", () => {
    useStore.getState().setTargetNetWorth(500000);
    expect(useStore.getState().targetNetWorth).toBe(500000);
  });

  it("setTargetNetWorth ignores invalid values", () => {
    useStore.getState().setTargetNetWorth(500000);
    useStore.getState().setTargetNetWorth(Number.NaN);
    expect(useStore.getState().targetNetWorth).toBe(500000);
  });

  it("defaults stochasticPreference to auto", () => {
    expect(useStore.getState().stochasticPreference).toBe("auto");
  });

  it("setStochasticPreference updates preference", () => {
    useStore.getState().setStochasticPreference("disabled");
    expect(useStore.getState().stochasticPreference).toBe("disabled");
  });

  it("defaults stochasticConfig", () => {
    expect(useStore.getState().stochasticConfig).toEqual({ runCount: 1000, seed: null });
  });

  it("setStochasticConfig updates config", () => {
    useStore.getState().setStochasticConfig({ runCount: 500, seed: 42 });
    expect(useStore.getState().stochasticConfig).toEqual({ runCount: 500, seed: 42 });
  });
});
