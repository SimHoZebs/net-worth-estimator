import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import type { PatternToExistingSchedulePreview } from "@/api/generated/model/patternToExistingSchedulePreview.ts";
import type { PatternToNewSchedulePreview } from "@/api/generated/model/patternToNewSchedulePreview.ts";
import { runInteractions } from "@/mocks/interactions.ts";
import { resetNotifications, useNotifications } from "@/state/notifications.ts";
import { PatternReview } from "./PatternReview.tsx";

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
	useDismissAnalysisFinding: () => dismiss,
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

function payment(
	id: string,
	overrides: Partial<AnalysisFinding> = {},
): AnalysisFinding {
	return {
		id,
		transactionId: id,
		streamId: "payroll-stream",
		kind: "income",
		provider: "acme",
		product: "monthly",
		role: "inflow",
		strength: "strong",
		status: "active",
		stale: false,
		dismissed: false,
		runId: "reviewed-run",
		feedbackRevision: 0,
		pattern: {
			patternId: "payroll",
			currency: "USD",
			typicalAmount: "2000.00",
			annualizedEstimate: "24000.00",
		},
		evidence: [{ code: "income", reason: "Three payroll deposits" }],
		...overrides,
	} as AnalysisFinding;
}

function recurring(id: string, transactionId: string): AnalysisFinding {
	return {
		id,
		transactionId,
		streamId: "payroll-stream",
		kind: "recurring",
		provider: "acme",
		product: "monthly",
		role: "inflow",
		strength: "moderate",
		status: "active",
		stale: false,
		dismissed: false,
		runId: "run",
		feedbackRevision: 0,
		evidence: [
			{
				code: "recurring.cadence",
				reason: "test",
				transactionIds: ["one", "two"],
			},
		],
	} as AnalysisFinding;
}

function creatablePreview(): PatternToNewSchedulePreview {
	return {
		findingId: "one",
		patternKey: "key",
		merchant: "acme",
		cadence: "monthly",
		occurrences: [
			{ transactionId: "one", date: "2026-01-16", amount: "2000.00" },
			{ transactionId: "two", date: "2026-02-16", amount: "2000.00" },
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

const names = new Map([
	["one", "ACME payroll"],
	["two", "ACME payroll"],
]);

const ui = (items: AnalysisFinding[], readOnly = false) => (
	<PatternReview findings={items} names={names} readOnly={readOnly} />
);

async function openRow(title: string) {
	await runInteractions([{ click: ["button", `Review ${title}`] }]);
	return screen.getByRole("dialog", { name: title });
}

beforeEach(() => {
	vi.clearAllMocks();
	createMutate.mockReset();
	addMutate.mockReset();
	review.isPending = review.isError = false;
	dismiss.isPending = dismiss.isError = false;
	previewState.data = undefined;
	previewState.isPending = false;
	previewState.isError = false;
	existingPreviewState.data = undefined;
	existingPreviewState.isPending = false;
	existingPreviewState.isError = false;
	resetNotifications();
});

describe("pattern review queue", () => {
	it("groups one stream into one row with tab counts", async () => {
		render(
			ui([
				payment("one"),
				payment("two"),
				recurring("r1", "one"),
				recurring("r2", "two"),
			]),
		);
		expect(
			screen
				.getByRole("tab", { name: "Review (1)" })
				.getAttribute("aria-selected"),
		).toBe("true");
		expect(screen.getByRole("tab", { name: "Saved (0)" })).toBeDefined();
		expect(screen.getByRole("tab", { name: "Dismissed (0)" })).toBeDefined();
		expect(
			screen.getByRole("button", { name: "Review ACME payroll" }),
		).toBeDefined();
		expect(screen.getByText(/2,000 USD typical · Deposit/)).toBeDefined();
		expect(screen.getByText(/Monthly · 2 recorded/)).toBeDefined();
		expect(screen.getByText("income?")).toBeDefined();
		expect(screen.getByText("Repeating")).toBeDefined();
		expect(screen.queryByText("52,000 USD")).toBeNull();
		expect(
			screen.queryByRole("button", { name: /Confirm income for/ }),
		).toBeNull();
		expect(screen.queryByText("Details")).toBeNull();
	});

	it("shows one compact row per stream", async () => {
		render(
			ui([
				payment("one", { streamId: "payroll-stream" }),
				payment("rent", {
					streamId: "rent-stream",
					transactionId: "rent",
					kind: "rent",
					provider: "landlord",
					product: "monthly",
					role: "outflow",
					pattern: {
						patternId: "lease",
						currency: "USD",
						typicalAmount: "1800.00",
						annualizedEstimate: "21600.00",
					},
				}),
			]),
		);
		expect(screen.getByRole("tab", { name: "Review (2)" })).toBeDefined();
		expect(
			screen.getByRole("button", { name: "Review ACME payroll" }),
		).toBeDefined();
		expect(screen.getByText(/1,800 USD typical/)).toBeDefined();
	});

	it("moves rows between tabs from answers only", async () => {
		const confirmed = payment("c", {
			streamId: undefined,
			transactionId: "c",
			review: { decision: "confirmed", provider: "acme", answeredAt: 1 },
		});
		const rejected = payment("r", {
			streamId: undefined,
			transactionId: "r",
			kind: "rent",
			provider: "landlord",
			review: { decision: "rejected", provider: "landlord", answeredAt: 1 },
		});
		const stale = payment("s", {
			streamId: undefined,
			transactionId: "s",
			provider: "utility",
			stale: true,
		});
		const withdrawn = payment("w", {
			streamId: undefined,
			transactionId: "w",
			provider: "bank",
			status: "withdrawn",
		});
		render(
			<PatternReview
				findings={[
					payment("p", {
						streamId: undefined,
						transactionId: "p",
						provider: "shop",
					}),
					confirmed,
					rejected,
					stale,
					withdrawn,
				]}
				names={new Map([["c", "ACME payroll"]])}
				readOnly={false}
			/>,
		);
		expect(screen.getByRole("tab", { name: "Review (3)" })).toBeDefined();
		expect(screen.getByRole("tab", { name: "Saved (1)" })).toBeDefined();
		expect(screen.getByRole("tab", { name: "Dismissed (1)" })).toBeDefined();
		expect(screen.getByText("income?")).toBeDefined();
		expect(screen.getByText("Awaiting analysis")).toBeDefined();
		expect(screen.getByText("Withdrawn")).toBeDefined();
		expect(screen.queryByText("Not rent")).toBeNull();
		await runInteractions([{ click: ["tab", "Saved (1)"] }]);
		expect(
			screen.getByRole("button", { name: "Review ACME payroll" }),
		).toBeDefined();
		expect(screen.getByText("income")).toBeDefined();
		expect(screen.queryByText("Awaiting analysis")).toBeNull();
		await runInteractions([{ click: ["tab", "Dismissed (1)"] }]);
		expect(
			screen.getByRole("button", { name: "Review Landlord" }),
		).toBeDefined();
		expect(screen.getByText("Not rent")).toBeDefined();
	});

	it("expands the row list", async () => {
		render(
			ui(
				Array.from({ length: 6 }, (_, index) =>
					payment(`deposit-${index}`, {
						streamId: undefined,
						transactionId: `deposit-${index}`,
					}),
				),
			),
		);
		expect(screen.getAllByRole("button", { name: /^Review / })).toHaveLength(5);
		await runInteractions([{ click: ["button", "Show more patterns"] }]);
		expect(screen.getAllByRole("button", { name: /^Review / })).toHaveLength(6);
	});

	it("offers no visibility actions on rows", async () => {
		render(ui([payment("one")]));
		expect(
			screen.queryByRole("button", { name: /Dismiss pattern for/ }),
		).toBeNull();
		expect(
			screen.queryByRole("button", { name: /Restore pattern for/ }),
		).toBeNull();
		expect(review.mutate).not.toHaveBeenCalled();
		expect(dismiss.mutate).not.toHaveBeenCalled();
	});

	it("renders nothing without reviewable findings", async () => {
		const view = render(
			ui([payment("one", { kind: "bnpl", pattern: undefined })]),
		);
		expect(view.container.textContent).toBe("");
	});
});

describe("pattern review dialog answers", () => {
	it("keeps explicit review available while an external judgment is pending", async () => {
		render(
			ui([
				payment("one", {
					judgment: { requestId: "request", status: "pending" },
				}),
			]),
		);
		const dialog = await openRow("ACME payroll");
		expect(within(dialog).getByText("Review pending")).toBeDefined();
		await runInteractions([
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
		const original = payment("one");
		const view = render(ui([original]));
		await openRow("ACME payroll");
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
		} as AnalysisFinding;
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
				} as AnalysisFinding,
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

	it("disables answers on stale evidence and while saving", async () => {
		const view = render(ui([payment("one", { stale: true })]));
		await openRow("ACME payroll");
		await runInteractions([
			{ expectDisabled: ["button", "Confirm income for ACME payroll"] },
			{ expectDisabled: ["button", "Not income for ACME payroll"] },
		]);
		review.isPending = true;
		view.rerender(ui([payment("one")]));
		await runInteractions([
			{ expectDisabled: ["button", "Confirm income for ACME payroll"] },
			{ expectDisabled: ["button", "Not income for ACME payroll"] },
		]);
		expect(review.mutate).not.toHaveBeenCalled();
	});

	it.each([
		[undefined, "Review (1)"],
		["confirmed", "Saved (1)"],
		["rejected", "Dismissed (1)"],
	])("disables withdrawn answers (%s)", async (decision, tab) => {
		const original = payment("one");
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
				} as AnalysisFinding,
			]),
		);
		if (decision) await runInteractions([{ click: ["tab", tab] }]);
		const dialog = await openRow("ACME payroll");
		expect(within(dialog).getByText("Withdrawn")).toBeDefined();
		await runInteractions([
			{ expectDisabled: ["button", "Confirm income for ACME payroll"] },
			{ expectDisabled: ["button", "Not income for ACME payroll"] },
		]);
		expect(review.mutate).not.toHaveBeenCalled();
	});

	it("preserves read-only access and reports save failures", async () => {
		const view = render(ui([payment("one")], true));
		await openRow("ACME payroll");
		expect(
			screen.queryByRole("button", { name: /Confirm income for/ }),
		).toBeNull();
		expect(screen.queryByRole("button", { name: /Not income for/ })).toBeNull();
		expect(
			screen.getByRole("button", {
				name: "Review forecast plan for ACME payroll",
			}),
		).toBeDefined();
		expect(
			screen.getByRole("button", {
				name: "Link to existing schedule for ACME payroll",
			}),
		).toBeDefined();
		expect(
			screen.queryByRole("button", { name: /Dismiss pattern for/ }),
		).toBeNull();
		review.isError = true;
		view.rerender(ui([payment("one")]));
		expect(screen.getByText("The answer could not be saved.")).toBeDefined();
		expect(
			screen.getByText("Confirm or correct suggested payment purposes."),
		).toBeDefined();
	});
});

describe("pattern review visibility", () => {
	it("dismisses and restores the whole stream", async () => {
		const items = [
			payment("one"),
			payment("two"),
			recurring("r1", "one"),
			recurring("r2", "two"),
		];
		const view = render(ui(items));
		await openRow("ACME payroll");
		await runInteractions([
			{ click: ["button", "Dismiss pattern for ACME payroll"] },
		]);
		expect(dismiss.mutate).toHaveBeenCalledTimes(4);
		expect(dismiss.mutate).toHaveBeenCalledWith({
			id: "one",
			dismissed: true,
		});
		// The review dialog stays open over the queue, and the nova dialog
		// hides the queue behind it. Close it before asserting queue state.
		await runInteractions([{ click: ["button", "Close"] }]);
		view.rerender(ui(items.map((item) => ({ ...item, dismissed: true }))));
		expect(screen.getByRole("tab", { name: "Review (0)" })).toBeDefined();
		expect(screen.getByRole("tab", { name: "Dismissed (1)" })).toBeDefined();
		expect(screen.getByText("No patterns need review.")).toBeDefined();
		await runInteractions([{ click: ["tab", "Dismissed (1)"] }]);
		const dialog = await openRow("ACME payroll");
		expect(within(dialog).getAllByText("Dismissed")).toHaveLength(2);
		await runInteractions([
			{ click: ["button", "Restore pattern for ACME payroll"] },
		]);
		expect(dismiss.mutate).toHaveBeenCalledTimes(8);
		expect(dismiss.mutate).toHaveBeenCalledWith({
			id: "two",
			dismissed: false,
		});
	});
});

describe("pattern repetition actions", () => {
	it("offers forecast actions without a standalone confirmation", async () => {
		render(ui([recurring("r1", "one"), recurring("r2", "two")]));
		expect(screen.getByText("Repeating")).toBeDefined();
		expect(screen.getByText(/Monthly · 2 recorded/)).toBeDefined();
		expect(screen.queryByRole("button", { name: /Confirm/ })).toBeNull();
		const dialog = await openRow("ACME payroll");
		expect(
			within(dialog).getByRole("button", {
				name: "Create forecast schedule for ACME payroll",
			}),
		).toBeDefined();
		await runInteractions([
			{ click: ["button", "Reject repeating pattern for ACME payroll"] },
		]);
		expect(review.mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "r1",
				input: expect.objectContaining({ action: "reject" }),
			}),
		);
	});

	it("reviews a rejected repetition again", async () => {
		render(
			ui([
				{
					...recurring("r1", "one"),
					review: { decision: "rejected", provider: "acme", answeredAt: 1 },
				} as AnalysisFinding,
				recurring("r2", "two"),
			]),
		);
		expect(screen.getByRole("tab", { name: "Dismissed (1)" })).toBeDefined();
		await runInteractions([{ click: ["tab", "Dismissed (1)"] }]);
		await openRow("ACME payroll");
		await runInteractions([
			{ click: ["button", "Review repeating pattern for ACME payroll again"] },
		]);
		expect(dismiss.mutate).toHaveBeenCalledWith({
			id: "r1",
			dismissed: false,
		});
	});

	it("leaves acceptance untouched when a preview is cancelled or creation fails", async () => {
		previewState.data = creatablePreview();
		render(ui([recurring("r1", "one"), recurring("r2", "two")]));
		await openRow("ACME payroll");
		await runInteractions([
			{ click: ["button", "Create forecast schedule for ACME payroll"] },
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
			) => {
				options?.onSuccess?.({ value: { name: "ACME payroll" } });
			},
		);
		render(ui([payment("one"), payment("two")]));
		await openRow("ACME payroll");
		await runInteractions([
			{ click: ["button", "Create forecast schedule for ACME payroll"] },
			{ click: ["button", "Create forecast schedule"] },
		]);
		const toast = useNotifications
			.getState()
			.items.find((item) => item.key === "forecast-schedule");
		expect(toast?.kind).toBe("success");
		expect(toast?.message).toBe("Forecast schedule “ACME payroll” created.");
		expect(
			screen.queryByRole("dialog", { name: /Forecast plan for/ }),
		).toBeNull();
		expect(createMutate).toHaveBeenCalledWith(
			{ id: "one" },
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
			render(ui([{ ...payment("one"), product }]));
			await openRow("ACME payroll");
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
			findingId: "one",
			patternKey: "key",
			scheduleId: "rent",
			scheduleName: "Rent",
			merchant: "acme",
			cadence: "monthly",
			accountId: "checking",
			claimable: true,
			reason: "",
			assignments: [
				{ transactionId: "one", date: "2026-01-16", amount: "2000.00" },
				{ transactionId: "two", date: "2026-02-16", amount: "2000.00" },
			],
		};
		addMutate.mockImplementation(
			(
				_args: unknown,
				options?: { onSuccess?: (result: { matches: unknown[] }) => void },
			) => options?.onSuccess?.({ matches: [{}, {}] }),
		);
		render(ui([payment("one")]));
		await openRow("ACME payroll");
		await runInteractions([
			{
				click: ["button", "Link to existing schedule for ACME payroll"],
			},
			{ expectText: "Matched occurrences" },
			{ click: ["button", "Link payments to schedule"] },
		]);
		expect(
			screen.getByText(/2 recorded payments now record an occurrence/),
		).toBeDefined();
		expect(addMutate).toHaveBeenCalledWith(
			{ id: "one", scheduleId: "rent" },
			expect.objectContaining({}),
		);
		expect(review.mutate).not.toHaveBeenCalled();
	});

	it("hides mutating plan actions in a read-only dialog", async () => {
		previewState.data = creatablePreview();
		render(ui([payment("one")], true));
		await openRow("ACME payroll");
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
			findingId: "one",
			patternKey: "key",
			scheduleId: "rent",
			scheduleName: "Rent",
			merchant: "acme",
			cadence: "monthly",
			accountId: "checking",
			claimable: true,
			reason: "",
			assignments: [
				{ transactionId: "one", date: "2026-01-16", amount: "2000.00" },
			],
		};
		render(ui([payment("one")], true));
		await openRow("ACME payroll");
		await runInteractions([
			{
				click: ["button", "Link to existing schedule for ACME payroll"],
			},
			{ expectText: "Matched occurrences" },
		]);
		expect(
			screen.queryByRole("button", { name: "Link payments to schedule" }),
		).toBeNull();
		expect(addMutate).not.toHaveBeenCalled();
	});
});
