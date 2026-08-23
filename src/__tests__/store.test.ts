import { beforeEach, describe, expect, it } from "vitest";
import type { FinancialModelDocument } from "@/lib/projection";
import { makeAccount, makePosting } from "@/lib/projection/__fixtures__";
import {
	DEFAULT_EVALUATIONS,
	selectCurrentChangeCount,
	selectModelOverrides,
	useStore,
} from "@/store";

function makeFinancialModelDocument(): FinancialModelDocument {
	return {
		sourcePath: "/configs",
		accounts: [makeAccount({ id: "a1", label: "Savings" })],
		checkpoints: [],
		evaluations: structuredClone(DEFAULT_EVALUATIONS),
		postings: [
			makePosting({
				id: "p1",
				label: "Salary",
				arithmetic: "5000",
				startDate: "2025-01-01",
			}),
		],
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
		const before = useStore.getState().addedAccounts;
		useStore.getState().addTemporaryAccount(makeAccount({ id: "a1" }));
		expect(useStore.getState().addedAccounts).toHaveLength(1);
		expect(useStore.getState().addedAccounts).not.toBe(before);
	});

	it("removes a temporary account by id", () => {
		useStore.getState().addTemporaryAccount(makeAccount({ id: "a1" }));
		useStore.getState().addTemporaryAccount(makeAccount({ id: "a2" }));
		useStore.getState().removeTemporaryAccount("a1");
		expect(useStore.getState().addedAccounts).toHaveLength(1);
		expect(useStore.getState().addedAccounts[0].id).toBe("a2");
	});

	it("adds a temporary posting", () => {
		useStore.getState().addTemporaryPosting(makePosting({ id: "p1" }));
		expect(useStore.getState().addedPostings).toHaveLength(1);
	});

	it("removes a temporary posting by id", () => {
		useStore.getState().addTemporaryPosting(makePosting({ id: "p1" }));
		useStore.getState().addTemporaryPosting(makePosting({ id: "p2" }));
		useStore.getState().removeTemporaryPosting("p1");
		expect(useStore.getState().addedPostings).toHaveLength(1);
		expect(useStore.getState().addedPostings[0].id).toBe("p2");
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
		useStore.getState().addTemporaryAccount(makeAccount({ id: "a1" }));
		useStore.getState().addTemporaryPosting(makePosting({ id: "p1" }));
		useStore.getState().toggleAccountDisabled("a1");
		useStore.getState().togglePostingDisabled("p1");
		useStore.getState().resetCurrentChanges();
		expect(useStore.getState().addedAccounts).toEqual([]);
		expect(useStore.getState().addedPostings).toEqual([]);
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
		useStore.getState().addTemporaryAccount(makeAccount({ id: "a1" }));
		useStore
			.getState()
			.addTemporaryAccount(makeAccount({ id: "a2", label: "Checking" }));
		useStore.getState().addTemporaryPosting(makePosting({ id: "p1" }));
		useStore.getState().toggleAccountDisabled("a1");
		expect(selectCurrentChangeCount(useStore.getState())).toBe(4);
	});

	it("selectModelOverrides returns the current overrides", () => {
		useStore.getState().resetCurrentChanges();
		useStore.getState().addTemporaryAccount(makeAccount({ id: "a1" }));
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
		useStore.getState().addTemporaryAccount(makeAccount({ id: "a1" }));
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

/* ------------------------------------------------------------------ */
/*  Editor slice tests                                                 */
/* ------------------------------------------------------------------ */

describe("Editor slice", () => {
	beforeEach(() => {
		useStore.getState().resetCurrentChanges();
		useStore.getState().cancelEditing();
	});

	describe("no-op when workingDocument is null", () => {
		it("ignores every editor action", () => {
			const before = useStore.getState();
			useStore.getState().updateAccount("a1", { label: "New" });
			useStore.getState().deleteAccount("a1");
			useStore.getState().addAccount(makeAccount({ id: "a1" }));
			useStore.getState().updatePosting("p1", { label: "New" });
			useStore.getState().deletePosting("p1");
			useStore.getState().addPosting(makePosting({ id: "p1" }));
			expect(useStore.getState()).toBe(before);
		});
	});

	describe("with a financial model document", () => {
		let document: FinancialModelDocument;

		beforeEach(() => {
			document = makeFinancialModelDocument();
		});

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
			useStore
				.getState()
				.addAccount(makeAccount({ id: "a2", label: "Checking" }));
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
			useStore.getState().addPosting(makePosting({ id: "p2" }));
			expect(useStore.getState().workingDocument?.postings).toHaveLength(2);
		});

		it("adds, updates, and removes canonical checkpoints", () => {
			useStore.getState().startEditing(document);
			useStore.getState().addCheckpoint({
				Date: "2026-01-01",
				AccountId: "a1",
				Balance: 100,
			});
			useStore.getState().updateCheckpoint(0, { Balance: 125 });
			expect(useStore.getState().workingDocument?.checkpoints).toEqual([
				{ Date: "2026-01-01", AccountId: "a1", Balance: 125 },
			]);

			useStore.getState().deleteCheckpoint(0);
			expect(useStore.getState().workingDocument?.checkpoints).toEqual([]);
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
		const evaluation =
			useStore.getState().evaluations.financialIndependence[0]!;
		useStore
			.getState()
			.updateEvaluationConfig("financialIndependence", evaluation.instanceId, {
				annualExpenseTarget: 50_000,
			});
		const updated = useStore.getState().evaluations.financialIndependence[0]!;
		expect(updated.instanceId).toBe(evaluation.instanceId);
		expect(updated.config).toMatchObject({ annualExpenseTarget: 50_000 });
	});

	it("replaces evaluation settings from a document without retaining references", () => {
		const evaluations = structuredClone(DEFAULT_EVALUATIONS);
		useStore.getState().replaceEvaluations(evaluations);

		evaluations.financialIndependence[0]!.label = "Changed outside the store";
		expect(useStore.getState().evaluations).toEqual(DEFAULT_EVALUATIONS);
	});

	it("duplicates and reorders evaluation instances with unique stable IDs", () => {
		const source = useStore.getState().evaluations.netWorthThreshold[0]!;
		useStore
			.getState()
			.duplicateEvaluation("netWorthThreshold", source.instanceId);
		const current = useStore.getState().evaluations.netWorthThreshold;
		const duplicate = current[1];
		expect(duplicate?.instanceId).not.toBe(source.instanceId);
		if (duplicate)
			useStore
				.getState()
				.moveEvaluation("netWorthThreshold", duplicate.instanceId, -1);
		const reordered = useStore.getState().evaluations.netWorthThreshold;
		expect(reordered[0]?.instanceId).toBe(duplicate?.instanceId);
	});

	it("rejects add and rename collisions without mutating evaluation order", () => {
		const before = structuredClone(useStore.getState().evaluations);
		useStore
			.getState()
			.addEvaluation(
				"financialIndependence",
				structuredClone(before.financialIndependence[0]!),
			);
		expect(useStore.getState().evaluations).toEqual(before);
		useStore
			.getState()
			.updateEvaluation(
				"financialIndependence",
				before.financialIndependence[0]!.instanceId,
				{ instanceId: before.netWorthThreshold[0]!.instanceId },
			);
		expect(useStore.getState().evaluations).toEqual(before);
	});

	it("removes only the selected stable evaluation instance", () => {
		const before = useStore.getState().evaluations.financialIndependence;
		useStore
			.getState()
			.removeEvaluation("financialIndependence", before[0]!.instanceId);
		expect(
			useStore
				.getState()
				.evaluations.financialIndependence.map(
					(evaluation) => evaluation.instanceId,
				),
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
