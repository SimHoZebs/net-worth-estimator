import { beforeEach, describe, expect, it } from "vitest";
import type { FinancialModelDocument } from "@/lib/projection";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";
import {
	DEFAULT_EVALUATIONS,
	selectCurrentChangeCount,
	selectModelOverrides,
	useStore,
} from "@/store";

/* ------------------------------------------------------------------ */
/*  Test helpers                                                       */
/* ------------------------------------------------------------------ */

function makeAccount(id = "a1", label = "Savings") {
	return {
		id,
		label,
		minBalance: NO_FLOOR,
		maxBalance: NO_CEILING,
		color: null,
		enabled: true,
	};
}

function makePosting(id = "p1") {
	return {
		id,
		label: "Salary",
		sourceAccountId: null,
		destinations: null,
		arithmetic: "5000",
		frequency: "monthly" as const,
		annualRate: 0,
		annualGrowthRate: 0,
		volatility: 0,
		startDate: "2025-01-01",
		endDate: null,
		annualCap: null,
		priority: 1,
		enabled: true,
	};
}

function makeCheckpoint(date = "2025-01-01", accountId = "a1", balance = 1000) {
	return { Date: date, AccountId: accountId, Balance: balance };
}

function makeFinancialModelDocument(): FinancialModelDocument {
	return {
		version: 9,
		sourcePath: "/configs",
		accounts: [
			{
				id: "a1",
				label: "Savings",
				minBalance: NO_FLOOR,
				maxBalance: NO_CEILING,
				color: null,
				enabled: true,
			},
		],
		checkpoints: [{ Date: "2025-01-01", AccountId: "a1", Balance: 1000 }],
		evaluations: structuredClone(DEFAULT_EVALUATIONS),
		postings: [makePosting("p1")],
	};
}

/* ------------------------------------------------------------------ */
/*  Model overrides slice tests                                        */
/* ------------------------------------------------------------------ */

describe("Model overrides slice", () => {
	beforeEach(() => {
		useStore.getState().resetCurrentChanges();
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
		useStore.getState().resetCurrentChanges();
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
	it("selectCurrentChangeCount returns correct count", () => {
		useStore.getState().resetCurrentChanges();
		useStore.getState().addTemporaryAccount(makeAccount());
		useStore.getState().addTemporaryAccount(makeAccount("a2", "Checking"));
		useStore.getState().addTemporaryPosting(makePosting());
		useStore.getState().toggleAccountDisabled("a1");
		expect(selectCurrentChangeCount(useStore.getState())).toBe(4);
	});

	it("selectModelOverrides returns the current overrides", () => {
		useStore.getState().resetCurrentChanges();
		useStore.getState().addTemporaryAccount(makeAccount());
		useStore.getState().togglePostingDisabled("p1");
		const modelOverrides = selectModelOverrides(useStore.getState());
		expect(modelOverrides.addedAccounts).toHaveLength(1);
		expect(modelOverrides.disabledPostingIds).toEqual(["p1"]);
	});
});

/* ------------------------------------------------------------------ */
/*  Comparison slice tests                                             */
/* ------------------------------------------------------------------ */

describe("Comparison slice", () => {
	beforeEach(() => {
		useStore.getState().clearComparisons();
		useStore.getState().resetCurrentChanges();
	});

	it("captures derived metrics without creating a restorable model", () => {
		useStore.getState().addTemporaryAccount(makeAccount());
		useStore.getState().captureCurrentComparison("Trial", {
			currentNetWorth: 100,
			finalNetWorth: 200,
			evaluationOutcomes: [],
			currentChangeCount: 1,
		});

		const snapshot = useStore.getState().comparisonSnapshots[0];
		expect(snapshot.label).toBe("Trial");
		expect(snapshot.metrics.currentChangeCount).toBe(1);
		expect(snapshot).not.toHaveProperty("modelOverrides");
		expect(snapshot).not.toHaveProperty("evaluations");
	});
});

/* ------------------------------------------------------------------ */
/*  Reference stability                                                */
/* ------------------------------------------------------------------ */

describe("Reference stability", () => {
	beforeEach(() => {
		useStore.getState().resetCurrentChanges();
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

	it("selectCurrentChangeCount returns stable values for identical state", () => {
		const a = selectCurrentChangeCount(useStore.getState());
		const b = selectCurrentChangeCount(useStore.getState());
		expect(a).toBe(b);
	});

	it("selectModelOverrides creates a new object each call", () => {
		// This is expected behaviour — memoization happens at the useShallow layer.
		const a = selectModelOverrides(useStore.getState());
		const b = selectModelOverrides(useStore.getState());
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
		useStore.getState().resetCurrentChanges();
		useStore.getState().cancelEditing();
	});

	describe("no-op when workingDocument is null", () => {
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

	describe("with a financial model document", () => {
		const document = makeFinancialModelDocument();

		it("startEditing clones the document and sets isEditing", () => {
			useStore.getState().startEditing(document);
			expect(useStore.getState().isEditing).toBe(true);
			expect(useStore.getState().isDirty).toBe(false);
			expect(useStore.getState().workingDocument).toEqual(document);
			expect(useStore.getState().workingDocument).not.toBe(document);
		});

		it("cancelEditing resets state", () => {
			useStore.getState().startEditing(document);
			useStore.getState().cancelEditing();
			expect(useStore.getState().isEditing).toBe(false);
			expect(useStore.getState().workingDocument).toBeNull();
		});

		it("updateAccount modifies workingDocument and sets isDirty", () => {
			useStore.getState().startEditing(document);
			useStore.getState().updateAccount("a1", { label: "Investment" });
			expect(useStore.getState().isDirty).toBe(true);
			expect(useStore.getState().workingDocument?.accounts[0].label).toBe(
				"Investment",
			);
		});

		it("deleteAccount removes from workingDocument", () => {
			useStore.getState().startEditing(document);
			useStore.getState().deleteAccount("a1");
			expect(useStore.getState().workingDocument?.accounts).toHaveLength(0);
		});

		it("addAccount appends to workingDocument", () => {
			useStore.getState().startEditing(document);
			useStore.getState().addAccount(makeAccount("a2", "Checking"));
			expect(useStore.getState().workingDocument?.accounts).toHaveLength(2);
		});

		it("updatePosting modifies posting in workingDocument", () => {
			useStore.getState().startEditing(document);
			useStore.getState().updatePosting("p1", { annualRate: 10000 });
			expect(useStore.getState().isDirty).toBe(true);
			expect(useStore.getState().workingDocument?.postings[0].annualRate).toBe(
				10000,
			);
		});

		it("deletePosting removes from workingDocument", () => {
			useStore.getState().startEditing(document);
			useStore.getState().deletePosting("p1");
			expect(useStore.getState().workingDocument?.postings).toHaveLength(0);
		});

		it("addPosting appends to workingDocument", () => {
			useStore.getState().startEditing(document);
			useStore.getState().addPosting(makePosting("p2"));
			expect(useStore.getState().workingDocument?.postings).toHaveLength(2);
		});

		it("addCheckpoint appends to workingDocument", () => {
			useStore.getState().startEditing(document);
			useStore
				.getState()
				.addCheckpoint(makeCheckpoint("2025-03-01", "a1", 2000));
			expect(useStore.getState().workingDocument?.checkpoints).toHaveLength(2);
		});

		it("deleteCheckpoint removes by index from workingDocument", () => {
			useStore.getState().startEditing(document);
			useStore.getState().deleteCheckpoint(0);
			expect(useStore.getState().workingDocument?.checkpoints).toHaveLength(0);
		});

		it("updateCheckpoint modifies checkpoint in workingDocument", () => {
			useStore.getState().startEditing(document);
			useStore.getState().updateCheckpoint(0, { Balance: 9999 });
			expect(useStore.getState().workingDocument?.checkpoints[0].Balance).toBe(
				9999,
			);
		});
	});
});

/* ------------------------------------------------------------------ */
/*  Settings slice tests                                               */
/* ------------------------------------------------------------------ */

describe("Settings slice", () => {
	beforeEach(() => {
		useStore.setState({ evaluations: structuredClone(DEFAULT_EVALUATIONS) });
	});

	it("updates an evaluation config without changing its stable ID", () => {
		const evaluation = useStore.getState().evaluations[0];
		useStore.getState().updateEvaluationConfig(evaluation.instanceId, {
			annualExpenseTarget: 50_000,
		});
		const updated = useStore.getState().evaluations[0];
		expect(updated.instanceId).toBe(evaluation.instanceId);
		expect(updated.config).toMatchObject({ annualExpenseTarget: 50_000 });
	});

	it("replaces evaluation settings from a document without retaining references", () => {
		const evaluations = structuredClone(DEFAULT_EVALUATIONS);
		useStore.getState().replaceEvaluations(evaluations);

		evaluations[0]!.label = "Changed outside the store";
		expect(useStore.getState().evaluations).toEqual(DEFAULT_EVALUATIONS);
	});

	it("duplicates and reorders evaluation instances with unique stable IDs", () => {
		const source = useStore.getState().evaluations[0];
		useStore.getState().duplicateEvaluation(source.instanceId);
		const current = useStore.getState().evaluations;
		const duplicate = current[current.length - 1];
		expect(duplicate?.definitionId).toBe(source.definitionId);
		expect(duplicate?.instanceId).not.toBe(source.instanceId);
		if (duplicate) useStore.getState().moveEvaluation(duplicate.instanceId, -1);
		const reordered = useStore.getState().evaluations;
		expect(reordered[reordered.length - 2]?.instanceId).toBe(
			duplicate?.instanceId,
		);
	});

	it("rejects add and rename collisions without mutating evaluation order", () => {
		const before = structuredClone(useStore.getState().evaluations);
		useStore.getState().addEvaluation(structuredClone(before[0]));
		expect(useStore.getState().evaluations).toEqual(before);
		useStore.getState().updateEvaluation(before[0].instanceId, {
			instanceId: before[1].instanceId,
		});
		expect(useStore.getState().evaluations).toEqual(before);
	});

	it("removes only the selected stable evaluation instance", () => {
		const before = useStore.getState().evaluations;
		useStore.getState().removeEvaluation(before[0].instanceId);
		expect(
			useStore
				.getState()
				.evaluations.map((evaluation) => evaluation.instanceId),
		).toEqual(before.slice(1).map((evaluation) => evaluation.instanceId));
	});

	it("defaults stochasticPreference to auto", () => {
		expect(useStore.getState().stochasticPreference).toBe("auto");
	});

	it("setStochasticPreference updates preference", () => {
		useStore.getState().setStochasticPreference("disabled");
		expect(useStore.getState().stochasticPreference).toBe("disabled");
	});

	it("defaults stochasticConfig", () => {
		expect(useStore.getState().stochasticConfig).toEqual({
			runCount: 1000,
			seed: null,
		});
	});

	it("setStochasticConfig updates config", () => {
		useStore.getState().setStochasticConfig({ runCount: 500, seed: 42 });
		expect(useStore.getState().stochasticConfig).toEqual({
			runCount: 500,
			seed: 42,
		});
	});
});
