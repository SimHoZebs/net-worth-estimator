import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { runInteractions } from "@/mocks/interactions.ts";
import { PaymentFindings as IncomeFindings } from "./PaymentFindings.tsx";

const review = vi.hoisted(() => ({
	mutate: vi.fn(),
	isPending: false,
	isError: false,
}));
vi.mock("@/state/analyses.ts", () => ({
	useReviewAnalysisFinding: () => review,
}));

function finding(id = "deposit"): AnalysisFinding {
	return {
		id,
		transactionId: id,
		analysisType: "payments",
		kind: "income",
		provider: "acme",
		product: "biweekly",
		role: "inflow",
		strength: "strong",
		status: "active",
		stale: false,
		dismissed: false,
		runId: "reviewed-run",
		feedbackRevision: 0,
		analyzerVersion: "payments-v2/policy",
		inputRevision: 1,
		firstDetectedAt: 1,
		lastCheckedAt: 1,
		pattern: {
			patternId: id,
			currency: "USD",
			typicalAmount: "2000.00",
			annualizedEstimate: "52000.00",
		},
		evidence: [
			{
				code: "income.main-inflow:annualized",
				reason: "Three payroll deposits",
				transactionIds: [id],
			},
		],
	};
}

const names = new Map([["deposit", "ACME payroll"]]);
const ui = (items: AnalysisFinding[], readOnly = false) => (
	<IncomeFindings findings={items} names={names} readOnly={readOnly} />
);

beforeEach(() => {
	vi.clearAllMocks();
	review.isPending = review.isError = false;
});

describe("income review", () => {
	it("keeps explicit review available while an external judgment is pending", async () => {
		render(
			ui([
				{ ...finding(), judgment: { requestId: "request", status: "pending" } },
			]),
		);
		await runInteractions([
			{ expectText: "Review pending" },
			{ expectEnabled: ["button", "Confirm income for ACME payroll"] },
			{ click: ["button", "Not income for ACME payroll"] },
		]);
		expect(review.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				input: expect.objectContaining({ action: "reject" }),
			}),
		);
	});
	it("can correct a confirmed answer and confirm a rejected answer", async () => {
		const original = finding();
		const view = render(ui([original]));
		await runInteractions([
			{ click: ["button", "Confirm income for ACME payroll"] },
		]);
		expect(review.mutate).toHaveBeenLastCalledWith({
			id: original.id,
			input: expect.objectContaining({
				runId: original.runId,
				revision: 0,
				action: "confirm",
			}),
		});
		const confirmed = {
			...original,
			feedbackRevision: 1,
			review: { decision: "confirmed", provider: "acme", answeredAt: 1 },
		};
		view.rerender(ui([confirmed]));
		await runInteractions([
			{ expectDisabled: ["button", "Confirm income for ACME payroll"] },
			{ click: ["button", "Not income for ACME payroll"] },
		]);
		expect(review.mutate).toHaveBeenLastCalledWith({
			id: original.id,
			input: expect.objectContaining({ revision: 1, action: "reject" }),
		});
		view.rerender(
			ui([
				{
					...confirmed,
					feedbackRevision: 2,
					review: { ...confirmed.review, decision: "rejected" },
				},
			]),
		);
		await runInteractions([
			{ click: ["button", "Confirm income for ACME payroll"] },
		]);
		expect(review.mutate).toHaveBeenLastCalledWith({
			id: original.id,
			input: expect.objectContaining({ revision: 2, action: "confirm" }),
		});
	});

	it("offers no visibility actions on the card", async () => {
		render(ui([finding()]));
		expect(
			screen.queryByRole("button", { name: /Dismiss income flag/ }),
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: /Restore income flag/ }),
		).toBeNull();
		expect(screen.queryByText("Details")).toBeNull();
		expect(review.mutate).not.toHaveBeenCalled();
	});

	it("disables answers on stale evidence and while saving", async () => {
		const view = render(ui([{ ...finding(), stale: true }]));
		await runInteractions([
			{ expectDisabled: ["button", "Confirm income for ACME payroll"] },
			{ expectDisabled: ["button", "Not income for ACME payroll"] },
		]);
		review.isPending = true;
		view.rerender(ui([finding()]));
		await runInteractions([
			{ expectDisabled: ["button", "Confirm income for ACME payroll"] },
			{ expectDisabled: ["button", "Not income for ACME payroll"] },
		]);
		expect(review.mutate).not.toHaveBeenCalled();
	});

	it("preserves read-only access and reports save failures", () => {
		const view = render(ui([finding()], true));
		expect(screen.queryByRole("button")).toBeNull();
		review.isError = true;
		view.rerender(ui([finding()]));
		expect(screen.getByText("The answer could not be saved.")).toBeDefined();
		expect(
			screen.getByText("Confirm or correct suggested payment purposes."),
		).toBeDefined();
	});

	it.each([undefined, "confirmed", "rejected"])(
		"disables withdrawn answers (%s)",
		async (decision) => {
			const original = finding();
			const view = render(ui([original]));
			view.rerender(
				ui([
					{
						...original,
						status: "withdrawn",
						stale: false,
						review: decision
							? { decision, provider: "acme", answeredAt: 1 }
							: undefined,
					},
				]),
			);
			await runInteractions([
				{ expectDisabled: ["button", "Confirm income for ACME payroll"] },
				{ expectDisabled: ["button", "Not income for ACME payroll"] },
				{ expectText: "Withdrawn" },
			]);
			expect(review.mutate).not.toHaveBeenCalled();
		},
	);

	it("expands the findings list", async () => {
		render(
			ui(Array.from({ length: 6 }, (_, index) => finding(`deposit-${index}`))),
		);
		expect(screen.getAllByRole("article")).toHaveLength(5);
		await runInteractions([
			{ click: ["button", "Show more payment patterns"] },
			{ expectAbsent: ["button", "Show more payment patterns"] },
		]);
		expect(screen.getAllByRole("article")).toHaveLength(6);
	});

	it("shows one compact card per pattern without a details disclosure", async () => {
		const first = finding();
		const second = {
			...finding("second"),
			pattern: first.pattern,
			evidence: first.evidence,
		};
		render(ui([first, second]));
		expect(screen.getAllByRole("article")).toHaveLength(1);
		expect(screen.getByText(/2,000 USD typical/)).toBeDefined();
		expect(screen.getByText(/2 recorded/)).toBeDefined();
		expect(screen.queryByText("52,000 USD")).toBeNull();
		expect(screen.queryByText("Three payroll deposits")).toBeNull();
		expect(screen.queryByText("Details")).toBeNull();
	});
});
