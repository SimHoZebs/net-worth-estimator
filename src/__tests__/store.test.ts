import { beforeEach, describe, expect, it } from "vitest";
import type { FinancialModelDocument } from "@/lib/projection";
import { makeAccount, makePosting } from "@/lib/projection/__fixtures__";
import {
	countDocumentDiff,
	DEFAULT_EVALUATIONS,
	selectCurrentChangeCount,
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
/*  Unsaved-diff count tests                                           */
/* ------------------------------------------------------------------ */

describe("selectCurrentChangeCount", () => {
	beforeEach(() => {
		useStore.getState().cancelEditing();
	});

	it("is zero when not editing", () => {
		expect(selectCurrentChangeCount(useStore.getState())).toBe(0);
	});

	it("is zero for a fresh draft", () => {
		useStore.getState().startEditing(makeFinancialModelDocument());
		expect(selectCurrentChangeCount(useStore.getState())).toBe(0);
	});

	it("counts added, removed, and modified rows", () => {
		const document = makeFinancialModelDocument();
		useStore.getState().startEditing(document);
		useStore
			.getState()
			.addAccount(makeAccount({ id: "a2", label: "Checking" }));
		useStore.getState().updatePosting("p1", { label: "Salary (new)" });
		useStore.getState().deleteAccount("a1");
		expect(selectCurrentChangeCount(useStore.getState())).toBe(3);
	});

	it("counts a disabled draft row as one change", () => {
		useStore.getState().startEditing(makeFinancialModelDocument());
		useStore.getState().updatePosting("p1", { enabled: false });
		expect(selectCurrentChangeCount(useStore.getState())).toBe(1);
		useStore.getState().updatePosting("p1", { enabled: true });
		expect(selectCurrentChangeCount(useStore.getState())).toBe(0);
	});

	it("counts checkpoint additions and removals", () => {
		useStore.getState().startEditing(makeFinancialModelDocument());
		useStore.getState().addCheckpoint({
			Date: "2026-01-01",
			AccountId: "a1",
			Balance: 100,
		});
		expect(selectCurrentChangeCount(useStore.getState())).toBe(1);
		useStore.getState().deleteCheckpoint(0);
		expect(selectCurrentChangeCount(useStore.getState())).toBe(0);
	});

	it("resets to zero after cancel or finish editing", () => {
		useStore.getState().startEditing(makeFinancialModelDocument());
		useStore.getState().addPosting(makePosting({ id: "p2", label: "Bonus" }));
		expect(selectCurrentChangeCount(useStore.getState())).toBe(1);
		useStore.getState().cancelEditing();
		expect(selectCurrentChangeCount(useStore.getState())).toBe(0);
		useStore.getState().startEditing(makeFinancialModelDocument());
		useStore.getState().finishEditing();
		expect(selectCurrentChangeCount(useStore.getState())).toBe(0);
	});
});

describe("countDocumentDiff", () => {
	it("returns zero for identical documents", () => {
		const document = makeFinancialModelDocument();
		expect(countDocumentDiff(document, structuredClone(document))).toBe(0);
	});
});

/* ------------------------------------------------------------------ */
/*  Comparison slice tests                                             */
/* ------------------------------------------------------------------ */

describe("Comparison slice", () => {
	beforeEach(() => {
		useStore.getState().clearComparisons();
		useStore.getState().cancelEditing();
	});

	it("captures derived metrics without creating a restorable model", () => {
		useStore.getState().startEditing(makeFinancialModelDocument());
		useStore.getState().addPosting(makePosting({ id: "p2", label: "Bonus" }));
		useStore.getState().captureCurrentComparison("Trial", {
			currentNetWorth: 100,
			finalNetWorth: 200,
			evaluationOutcomes: [],
			currentChangeCount: selectCurrentChangeCount(useStore.getState()),
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

		it("startEditing captures a baseline for the unsaved-diff count", () => {
			useStore.getState().startEditing(document);
			expect(useStore.getState().editingBaseline).toEqual(document);
			expect(useStore.getState().editingBaseline).not.toBe(document);
			expect(useStore.getState().editingBaseline).not.toBe(
				useStore.getState().workingDocument,
			);
		});

		it("cancelEditing resets state", () => {
			useStore.getState().startEditing(document);
			useStore.getState().cancelEditing();
			expect(useStore.getState().isEditing).toBe(false);
			expect(useStore.getState().workingDocument).toBeNull();
			expect(useStore.getState().editingBaseline).toBeNull();
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
		useStore.setState({
			evaluations: structuredClone(DEFAULT_EVALUATIONS),
			lastEvaluationSyncAt: null,
		});
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
		useStore.getState().syncEvaluationsFromDocument(evaluations, 1);

		evaluations.financialIndependence[0]!.label = "Changed outside the store";
		expect(useStore.getState().evaluations).toEqual(DEFAULT_EVALUATIONS);
	});

	it("ignores repeat syncs for the same timestamp so session edits survive", () => {
		useStore
			.getState()
			.syncEvaluationsFromDocument(structuredClone(DEFAULT_EVALUATIONS), 1);
		useStore
			.getState()
			.updateEvaluation("financialIndependence", "financial-independence", {
				label: "Session edit",
			});
		useStore
			.getState()
			.syncEvaluationsFromDocument(structuredClone(DEFAULT_EVALUATIONS), 1);
		expect(
			useStore.getState().evaluations.financialIndependence[0]!.label,
		).toBe("Session edit");
	});

	it("re-seeds on a new timestamp or a forced reload", () => {
		useStore
			.getState()
			.syncEvaluationsFromDocument(structuredClone(DEFAULT_EVALUATIONS), 1);
		useStore
			.getState()
			.updateEvaluation("financialIndependence", "financial-independence", {
				label: "Session edit",
			});
		useStore
			.getState()
			.syncEvaluationsFromDocument(structuredClone(DEFAULT_EVALUATIONS), 2);
		expect(
			useStore.getState().evaluations.financialIndependence[0]!.label,
		).toBe("Financial independence");

		useStore
			.getState()
			.updateEvaluation("financialIndependence", "financial-independence", {
				label: "Session edit",
			});
		useStore
			.getState()
			.syncEvaluationsFromDocument(structuredClone(DEFAULT_EVALUATIONS), 2, {
				force: true,
			});
		expect(
			useStore.getState().evaluations.financialIndependence[0]!.label,
		).toBe("Financial independence");
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
