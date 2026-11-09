import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { runInteractions } from "@/mocks/interactions.ts";
import { IncomeFindings } from "./IncomeFindings.tsx";

const review = vi.hoisted(() => ({
	mutate: vi.fn(),
	isPending: false,
	isError: false,
}));
const dismiss = vi.hoisted(() => ({
	mutate: vi.fn(),
	isPending: false,
	isError: false,
}));
vi.mock("@/state/analyses.ts", () => ({
	useReviewAnalysisFinding: () => review,
	useDismissAnalysisFinding: () => dismiss,
}));

function finding(id = "deposit"): AnalysisFinding {
	return {
		id,
		transactionId: id,
		analysisType: "income",
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
		analyzerVersion: "income-v1",
		inputRevision: 1,
		firstDetectedAt: 1,
		lastCheckedAt: 1,
		income: {
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

// DOM Testing Library does not map summary's native disclosure role. Exercise
// the real element with user-event; browser scenarios verify its accessibility.
async function toggleDetails() {
	await userEvent.setup().click(screen.getByText("Details"));
}

beforeEach(() => {
	vi.clearAllMocks();
	review.isPending =
		dismiss.isPending =
		review.isError =
		dismiss.isError =
			false;
});
afterEach(cleanup);

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
					dismissed: true,
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

	it("keeps visibility actions separate from training answers", async () => {
		const original = finding();
		const view = render(ui([original]));
		await toggleDetails();
		await runInteractions([
			{ click: ["button", "Dismiss income flag for ACME payroll"] },
		]);
		expect(dismiss.mutate).toHaveBeenLastCalledWith({
			id: original.id,
			dismissed: true,
		});
		view.rerender(
			ui([
				{
					...original,
					dismissed: true,
					review: { decision: "rejected", provider: "acme", answeredAt: 1 },
				},
			]),
		);
		await runInteractions([
			{ click: ["button", "Restore income flag for ACME payroll"] },
		]);
		expect(dismiss.mutate).toHaveBeenLastCalledWith({
			id: original.id,
			dismissed: false,
		});
		await runInteractions([
			{ click: ["button", "Restore income flag for ACME payroll"] },
		]);
		expect(review.mutate).not.toHaveBeenCalled();
	});

	it("disables answers on stale evidence and all controls while saving", async () => {
		const view = render(ui([{ ...finding(), stale: true }]));
		await runInteractions([
			{ expectDisabled: ["button", "Confirm income for ACME payroll"] },
			{ expectDisabled: ["button", "Not income for ACME payroll"] },
		]);
		review.isPending = true;
		view.rerender(ui([finding()]));
		await toggleDetails();
		await runInteractions([
			{ expectDisabled: ["button", "Dismiss income flag for ACME payroll"] },
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
			screen.getByText("Confirm or correct suggested income."),
		).toBeDefined();
	});

	it.each([undefined, "confirmed", "rejected"])(
		"disables withdrawn answers while retaining visibility controls (%s)",
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
			await toggleDetails();
			await runInteractions([
				{ expectDisabled: ["button", "Confirm income for ACME payroll"] },
				{ expectDisabled: ["button", "Not income for ACME payroll"] },
				{ expectEnabled: ["button", "Dismiss income flag for ACME payroll"] },
				{
					expectText:
						"This pattern no longer applies. Answers are unavailable.",
				},
			]);
			expect(review.mutate).not.toHaveBeenCalled();
		},
	);

	it("expands the findings list", async () => {
		render(
			ui(Array.from({ length: 6 }, (_, index) => finding(`deposit-${index}`))),
		);
		await runInteractions([
			{ click: ["button", "Show more income"] },
			{ expectAbsent: ["button", "Show more income"] },
		]);
		expect(screen.getAllByRole("row")).toHaveLength(7);
	});

	it("shows one compact row per pattern and discloses evidence only on request", async () => {
		const first = finding();
		const second = {
			...finding("second"),
			income: first.income,
			evidence: first.evidence,
		};
		render(ui([first, second]));
		expect(screen.getAllByRole("row")).toHaveLength(2);
		expect(screen.getByText("52,000 USD")).toBeDefined();
		const details = screen
			.getByText("Three payroll deposits")
			.closest("details")!;
		expect(details.open).toBe(false);
		await toggleDetails();
		expect(details.open).toBe(true);
		await toggleDetails();
		expect(details.open).toBe(false);
	});
});
