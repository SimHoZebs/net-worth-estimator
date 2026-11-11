import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import type { PatternToExistingSchedulePreview } from "@/api/generated/model/patternToExistingSchedulePreview.ts";
import type { PatternToNewSchedulePreview } from "@/api/generated/model/patternToNewSchedulePreview.ts";
import { runInteractions } from "@/mocks/interactions.ts";
import { PaymentFindings as IncomeFindings } from "./PaymentFindings.tsx";

const review = vi.hoisted(() => ({
	mutate: vi.fn(),
	isPending: false,
	isError: false,
}));
const createMutate = vi.hoisted(() => vi.fn());
const addMutate = vi.hoisted(() => vi.fn());
const previewState = vi.hoisted(() => ({
	data: undefined as PatternToNewSchedulePreview | undefined,
	isPending: false,
	isError: false,
}));
const existingPreviewState = vi.hoisted(() => ({
	data: undefined as PatternToExistingSchedulePreview | undefined,
	isPending: false,
	isError: false,
}));
vi.mock("@/state/analyses.ts", () => ({
	useReviewAnalysisFinding: () => review,
	usePatternToNewSchedulePreview: () => previewState,
	useCreatePatternToNewSchedule: () => ({
		mutate: createMutate,
		isPending: false,
	}),
	usePatternToExistingSchedulePreview: () => existingPreviewState,
	useAddPatternToExistingSchedule: () => ({
		mutate: addMutate,
		isPending: false,
	}),
}));
vi.mock("@/state/workspaceResources.ts", () => ({
	useTransactionCatalog: () => ({
		data: { items: [{ id: "rent", kind: "schedule", name: "Rent" }] },
	}),
}));
vi.mock("@/state/savedState.ts", () => ({
	useSavedAccounts: () => [{ id: "checking", name: "Everyday checking" }],
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

function creatablePreview(): PatternToNewSchedulePreview {
	return {
		findingId: "deposit",
		patternKey: "key",
		merchant: "acme",
		cadence: "monthly",
		occurrences: [
			{ transactionId: "deposit", date: "2026-01-16", amount: "2000.00" },
			{ transactionId: "deposit-2", date: "2026-02-16", amount: "2000.00" },
		],
		typicalAmount: "2000.00",
		currency: "USD",
		direction: "inflow",
		accountId: "checking",
		creatable: true,
		reason: "",
		schedule: {
			name: "ACME payroll",
			sourceAccountId: "checking",
			destinations: [],
			amount: "2000.00",
			frequency: "monthly",
			startDate: "2026-02-13",
			enabled: true,
		},
		upcoming: [{ date: "2026-02-13", amount: "2000.00" }],
	} as PatternToNewSchedulePreview;
}

const names = new Map([["deposit", "ACME payroll"]]);
const ui = (items: AnalysisFinding[], readOnly = false) => (
	<IncomeFindings findings={items} names={names} readOnly={readOnly} />
);

beforeEach(() => {
	vi.clearAllMocks();
	createMutate.mockReset();
	addMutate.mockReset();
	review.isPending = review.isError = false;
	previewState.data = undefined;
	previewState.isPending = false;
	previewState.isError = false;
	existingPreviewState.data = undefined;
	existingPreviewState.isPending = false;
	existingPreviewState.isError = false;
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
		expect(
			screen.queryByRole("button", { name: /Confirm income for/ }),
		).toBeNull();
		expect(screen.queryByRole("button", { name: /Not income for/ })).toBeNull();
		expect(
			screen.queryByRole("button", {
				name: "Create forecast schedule for ACME payroll",
			}),
		).toBeNull();
		expect(
			screen.getByRole("button", {
				name: "Review forecast plan for ACME payroll",
			}),
		).toBeDefined();
		expect(
			screen.getByRole("button", {
				name: "Link payment pattern for ACME payroll to an existing schedule",
			}),
		).toBeDefined();
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

describe("payment forecast actions", () => {
	it("leaves the answer unsaved when a preview is cancelled or creation fails", async () => {
		previewState.data = creatablePreview();
		render(ui([finding()]));
		await runInteractions([
			{ click: ["button", "Create forecast schedule for ACME payroll"] },
			{ expectText: "Suggested schedule" },
			{ click: ["button", "Cancel"] },
		]);
		expect(createMutate).not.toHaveBeenCalled();
		expect(review.mutate).not.toHaveBeenCalled();
		createMutate.mockImplementation(
			(_args: unknown, options: { onError: () => void }) => options.onError(),
		);
		await runInteractions([
			{ click: ["button", "Create forecast schedule for ACME payroll"] },
			{ click: ["button", "Create forecast schedule"] },
			{ expectText: "The schedule could not be created." },
		]);
		expect(review.mutate).not.toHaveBeenCalled();
	});

	it("creates a forecast schedule from the reviewed plan", async () => {
		previewState.data = creatablePreview();
		createMutate.mockImplementation(
			(
				_args: unknown,
				options?: { onSuccess?: (result: { value: { name: string } }) => void },
			) => options?.onSuccess?.({ value: { name: "ACME payroll" } }),
		);
		render(ui([finding()]));
		await runInteractions([
			{ click: ["button", "Create forecast schedule for ACME payroll"] },
			{ click: ["button", "Create forecast schedule"] },
		]);
		expect(screen.getByRole("status").textContent).toContain(
			"Forecast schedule “ACME payroll” created.",
		);
		expect(createMutate).toHaveBeenCalledWith(
			{ id: "deposit" },
			expect.objectContaining({}),
		);
		expect(review.mutate).not.toHaveBeenCalled();
	});

	it.each([
		[
			"biweekly",
			"biweekly",
			"Patterns that repeat Every 2 weeks cannot become forecast schedules yet.",
		],
		[
			"no cadence",
			"",
			"Recorded payments without a regular cadence cannot become forecast schedules yet.",
		],
	])(
		"explains plans that cannot become schedules with %s repetition",
		async (_label, product, reason) => {
			previewState.data = {
				...creatablePreview(),
				creatable: false,
				schedule: undefined,
				upcoming: [],
				reason,
			};
			render(ui([{ ...finding(), product }]));
			await runInteractions([
				{ click: ["button", "Create forecast schedule for ACME payroll"] },
				{ expectText: reason },
			]);
			expect(
				screen.queryByRole("button", { name: "Create forecast schedule" }),
			).toBeNull();
			expect(createMutate).not.toHaveBeenCalled();
		},
	);

	it("links recorded payments to an existing schedule", async () => {
		existingPreviewState.data = {
			findingId: "deposit",
			patternKey: "key",
			scheduleId: "rent",
			scheduleName: "Rent",
			merchant: "acme",
			cadence: "monthly",
			accountId: "checking",
			claimable: true,
			reason: "",
			assignments: [
				{ transactionId: "deposit", date: "2026-01-16", amount: "2000.00" },
				{ transactionId: "deposit-2", date: "2026-02-16", amount: "2000.00" },
			],
		};
		addMutate.mockImplementation(
			(
				_args: unknown,
				options?: { onSuccess?: (result: { matches: unknown[] }) => void },
			) => options?.onSuccess?.({ matches: [{}, {}] }),
		);
		render(ui([finding()]));
		await runInteractions([
			{
				click: [
					"button",
					"Link payment pattern for ACME payroll to an existing schedule",
				],
			},
			{ expectText: "Matched occurrences" },
			{ click: ["button", "Link payments to schedule"] },
		]);
		expect(
			screen.getByText(/2 recorded payments now record an occurrence/),
		).toBeDefined();
		expect(addMutate).toHaveBeenCalledWith(
			{ id: "deposit", scheduleId: "rent" },
			expect.objectContaining({}),
		);
		expect(review.mutate).not.toHaveBeenCalled();
	});

	it("hides mutating plan actions in a read-only dialog", async () => {
		previewState.data = creatablePreview();
		render(ui([finding()], true));
		await runInteractions([
			{ click: ["button", "Review forecast plan for ACME payroll"] },
			{ expectText: "Suggested schedule" },
		]);
		expect(
			screen.queryByRole("button", { name: "Create forecast schedule" }),
		).toBeNull();
		expect(createMutate).not.toHaveBeenCalled();
	});

	it("hides mutating link actions in a read-only dialog", async () => {
		existingPreviewState.data = {
			findingId: "deposit",
			patternKey: "key",
			scheduleId: "rent",
			scheduleName: "Rent",
			merchant: "acme",
			cadence: "monthly",
			accountId: "checking",
			claimable: true,
			reason: "",
			assignments: [
				{ transactionId: "deposit", date: "2026-01-16", amount: "2000.00" },
			],
		};
		render(ui([finding()], true));
		await runInteractions([
			{
				click: [
					"button",
					"Link payment pattern for ACME payroll to an existing schedule",
				],
			},
			{ expectText: "Matched occurrences" },
		]);
		expect(
			screen.queryByRole("button", { name: "Link payments to schedule" }),
		).toBeNull();
		expect(addMutate).not.toHaveBeenCalled();
	});
});
