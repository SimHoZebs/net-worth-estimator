import { describe, expect, it, vi } from "vitest";
import {
	createPostingClassificationAnalysis,
	createPostingClassificationPlan,
	runAnalysis,
} from "@/lib/analysis";
import type {
	PostingClassificationValue,
	PostingClassifier,
} from "./classification";
import {
	payerClassifier,
	paymentRailClassifier,
	payrollClassifier,
} from "./postingClassifiers";
import type { PostingObservation } from "./postingObservations";

function posting(
	id: string,
	changes: Partial<PostingObservation> = {},
): PostingObservation {
	return {
		id,
		postingId: id,
		accountId: "checking",
		bookedDate: "2026-01-01",
		amount: 2000,
		currency: "USD",
		description: "ACME PAYROLL",
		counterpartyName: null,
		...changes,
	};
}

const payrollPlan = createPostingClassificationPlan([
	payerClassifier,
	payrollClassifier,
	paymentRailClassifier,
]);
const classificationAnalysis = createPostingClassificationAnalysis(payrollPlan);

describe("posting classification", () => {
	it("runs only selected classifier definitions", async () => {
		const selected = classifier("selected");
		const omitted = classifier("omitted");
		const result = await classificationAnalysisFor([selected]).run({
			input: { postings: [posting("one"), posting("two")] },
		});

		expect(selected.classify).toHaveBeenCalledTimes(2);
		expect(omitted.classify).not.toHaveBeenCalled();
		expect(result.value.postings[0]?.classifications.get(selected)?.value).toBe(
			true,
		);
	});

	it("combines requirement sets and evaluates shared definitions once", () => {
		const shared = classifier("shared");
		const sibling = classifier("sibling");
		const analysis = createPostingClassificationAnalysis(
			createPostingClassificationPlan([shared], [shared, sibling]),
		);

		analysis.run({ input: { postings: [posting("one")] } });

		expect(shared.classify).toHaveBeenCalledTimes(1);
		expect(sibling.classify).toHaveBeenCalledTimes(1);
	});

	it("rejects different definitions with the same id", () => {
		expect(() =>
			createPostingClassificationPlan(
				[classifier("duplicate")],
				[classifier("duplicate")],
			),
		).toThrow(
			'Conflicting posting classifier definitions share the id "duplicate".',
		);
	});

	it("classifies payroll evidence and exposes typed payer and rail values", async () => {
		const result = await classificationAnalysis.run({
			input: {
				postings: [
					posting("amazon", {
						description: "AMAZON DEVELOPME PAYROLL PPD ID: 9111111103",
						counterpartyName: "ACH credit",
					}),
				],
			},
		});
		const classifications = result.value.postings[0]!.classifications;

		expect(classifications.get(payerClassifier)?.value).toEqual({
			identity: "amazon developme",
			label: "amazon developme",
		});
		expect(classifications.get(payrollClassifier)?.value).toBe(true);
		expect(classifications.get(paymentRailClassifier)?.value).toBe("ach");
		expect(
			classifications
				.evidenceFor([
					payerClassifier,
					payrollClassifier,
					paymentRailClassifier,
				])
				.map(({ code }) => code),
		).toEqual(["payer.identity", "payroll.language", "payment-rail.ach"]);
	});

	it("does not infer payroll from debit, unresolved, or uninformative postings", async () => {
		const result = await classificationAnalysis.run({
			input: {
				postings: [
					posting("debit", { amount: -2000 }),
					posting("unresolved", { amount: null }),
					posting("unknown", {
						description: "CARD CREDIT",
						counterpartyName: "---",
					}),
				],
			},
		});

		expect(
			result.value.postings.map(({ classifications }) =>
				classifications.get(payrollClassifier),
			),
		).toEqual([null, null, null]);
	});

	it("keeps classifier failures inside the analysis runtime", async () => {
		const broken: PostingClassifier<"broken", true> = {
			id: "broken",
			classify() {
				throw new Error("classification exploded");
			},
		};
		const result = await runAnalysis(classificationAnalysisFor([broken]), {
			postings: [posting("one")],
		});

		expect(result).toMatchObject({
			state: "error",
			value: null,
			diagnostics: [{ message: "classification exploded" }],
		});
	});
});

function classifier<TId extends string>(id: TId) {
	return {
		id,
		classify: vi.fn<
			(posting: PostingObservation) => PostingClassificationValue<true>
		>(() => ({ value: true, evidence: [] })),
	} satisfies PostingClassifier<TId, true>;
}

function classificationAnalysisFor(
	classifiers: readonly PostingClassifier<string, unknown>[],
) {
	return createPostingClassificationAnalysis(
		createPostingClassificationPlan(classifiers),
	);
}
