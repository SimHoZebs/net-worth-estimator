import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import type { RecurringLinkPreview } from "@/api/generated/model/recurringLinkPreview.ts";
import type { RecurringPromotionPreview } from "@/api/generated/model/recurringPromotionPreview.ts";
import { RecurringPatterns } from "./RecurringPatterns.tsx";

const reviewMutate = vi.hoisted(() => vi.fn());
const dismissMutate = vi.hoisted(() => vi.fn());
const promoteMutate = vi.hoisted(() => vi.fn());
const linkMutate = vi.hoisted(() => vi.fn());
const previewState = vi.hoisted(() => ({
	data: undefined as RecurringPromotionPreview | undefined,
	isPending: false,
	isError: false,
}));
const linkPreviewState = vi.hoisted(() => ({
	data: undefined as RecurringLinkPreview | undefined,
	isPending: false,
	isError: false,
}));

vi.mock("@/state/analyses.ts", () => ({
	useReviewAnalysisFinding: () => ({
		mutate: reviewMutate,
		isPending: false,
		isError: false,
	}),
	useDismissAnalysisFinding: () => ({
		mutate: dismissMutate,
		isPending: false,
		isError: false,
	}),
	useRecurringPreview: () => previewState,
	usePromoteRecurringPattern: () => ({
		mutate: promoteMutate,
		isPending: false,
	}),
	useRecurringLinkPreview: () => linkPreviewState,
	useLinkRecurringPattern: () => ({
		mutate: linkMutate,
		isPending: false,
	}),
}));

vi.mock("@/state/workspaceResources.ts", () => ({
	useTransactionCatalog: () => ({
		data: { items: [{ id: "rent", kind: "rule", name: "Rent" }] },
	}),
}));

vi.mock("@/state/savedRows.ts", () => ({
	useSavedAccounts: () => [{ id: "checking", name: "Everyday checking" }],
}));

function recurringFinding(id: string, postingId: string): AnalysisFinding {
	return {
		id,
		postingId,
		kind: "recurring",
		provider: "grocer",
		product: "monthly",
		role: "outflow",
		strength: "moderate",
		status: "active",
		stale: false,
		dismissed: false,
		runId: "run",
		feedbackRevision: 0,
		evidence: [
			{ code: "recurring.cadence", reason: "test", postingIds: ["a", "b"] },
		],
	} as AnalysisFinding;
}

function promotablePreview(): RecurringPromotionPreview {
	return {
		findingId: "one",
		patternKey: "key",
		merchant: "grocer",
		cadence: "monthly",
		occurrences: [
			{ postingId: "a", date: "2026-01-15", amount: "30.00" },
			{ postingId: "b", date: "2026-02-15", amount: "30.00" },
		],
		typicalAmount: "30.00",
		currency: "USD",
		direction: "outflow",
		accountId: "checking",
		promotable: true,
		reason: "",
		rule: {
			name: "Grocer",
			sourceAccountId: "checking",
			destinations: [],
			amount: "30.00",
			frequency: "monthly",
			startDate: "2026-03-15",
			enabled: true,
		},
		upcoming: [
			{ date: "2026-03-15", amount: "30.00" },
			{ date: "2026-04-15", amount: "30.00" },
		],
	} as RecurringPromotionPreview;
}

const names = new Map([
	["a", "Grocer"],
	["b", "Grocer"],
]);

beforeEach(() => {
	window.HTMLDialogElement.prototype.showModal = function (
		this: HTMLDialogElement,
	) {
		this.setAttribute("open", "");
	};
	window.HTMLDialogElement.prototype.close = function (
		this: HTMLDialogElement,
	) {
		this.removeAttribute("open");
	};
	previewState.data = undefined;
	previewState.isPending = false;
	previewState.isError = false;
	linkPreviewState.data = undefined;
	linkPreviewState.isPending = false;
	linkPreviewState.isError = false;
	vi.clearAllMocks();
});

afterEach(cleanup);

describe("repeating-payment patterns", () => {
	it("confirms the pattern without leaving the list", () => {
		render(
			<RecurringPatterns
				findings={[recurringFinding("one", "a"), recurringFinding("two", "b")]}
				names={names}
				readOnly={false}
			/>,
		);
		expect(screen.getByText("Grocer")).toBeDefined();
		expect(screen.getByText("Monthly · Payment · 2 recorded")).toBeDefined();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Confirm repeating pattern for Grocer",
			}),
		);
		expect(reviewMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				id: "one",
				input: expect.objectContaining({ action: "confirm" }),
			}),
		);
	});
	it("approves the reviewed plan explicitly", () => {
		previewState.data = promotablePreview();
		render(
			<RecurringPatterns
				findings={[recurringFinding("one", "a"), recurringFinding("two", "b")]}
				names={names}
				readOnly={false}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Review forecast plan for Grocer" }),
		);
		expect(screen.getByText("2026-03-15 · 30.00 USD")).toBeDefined();
		expect(
			screen.getByText(
				"2 recorded payments · 30.00 USD typical · 2026-01-15 to 2026-02-15",
			),
		).toBeDefined();
		promoteMutate.mockImplementation(
			(
				_args: unknown,
				options?: { onSuccess?: (result: { row: { name: string } }) => void },
			) => {
				options?.onSuccess?.({ row: { name: "Grocer" } });
			},
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Approve and create rule" }),
		);
		expect(promoteMutate).toHaveBeenCalledWith(
			{ id: "one" },
			expect.objectContaining({}),
		);
		expect(screen.getByText(/Forecast rule “Grocer” created/)).toBeDefined();
	});
	it("explains plans that cannot become rules yet", () => {
		previewState.data = {
			...promotablePreview(),
			promotable: false,
			rule: undefined,
			upcoming: [],
			reason:
				"Patterns that repeat every 2 weeks cannot become forecast rules yet.",
		};
		render(
			<RecurringPatterns
				findings={[recurringFinding("one", "a"), recurringFinding("two", "b")]}
				names={names}
				readOnly={false}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Review forecast plan for Grocer" }),
		);
		expect(screen.getByText(/cannot become forecast rules yet/)).toBeDefined();
		expect(
			screen.queryByRole("button", { name: "Approve and create rule" }),
		).toBeNull();
	});
	it("hides answers and approval in read-only mode", () => {
		render(
			<RecurringPatterns
				findings={[recurringFinding("one", "a"), recurringFinding("two", "b")]}
				names={names}
				readOnly
			/>,
		);
		expect(screen.queryByRole("button", { name: "Confirm" })).toBeNull();
		expect(
			screen.getByRole("button", { name: "Review forecast plan for Grocer" }),
		).toBeDefined();
	});
	it("links confirmed payments to an existing rule", () => {
		linkPreviewState.data = {
			findingId: "one",
			patternKey: "key",
			ruleId: "rent",
			ruleName: "Rent",
			merchant: "grocer",
			cadence: "monthly",
			accountId: "checking",
			linkable: true,
			reason: "",
			assignments: [
				{ postingId: "a", date: "2026-01-15", amount: "30.00" },
				{ postingId: "b", date: "2026-02-15", amount: "30.00" },
			],
		};
		render(
			<RecurringPatterns
				findings={[recurringFinding("one", "a"), recurringFinding("two", "b")]}
				names={names}
				readOnly={false}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", {
				name: "Link repeating pattern for Grocer to an existing rule",
			}),
		);
		expect(screen.getByText("Matched occurrences")).toBeDefined();
		linkMutate.mockImplementation(
			(
				_args: unknown,
				options?: { onSuccess?: (result: { rows: unknown[] }) => void },
			) => {
				options?.onSuccess?.({ rows: [{}, {}] });
			},
		);
		fireEvent.click(
			screen.getByRole("button", { name: "Link payments to rule" }),
		);
		expect(linkMutate).toHaveBeenCalledWith(
			expect.objectContaining({ ruleId: "rent" }),
			expect.objectContaining({}),
		);
		expect(screen.getAllByText(/an occurrence/).length).toBeGreaterThan(0);
	});
	it("hides the link action in a read-only dialog", () => {
		linkPreviewState.data = {
			findingId: "one",
			patternKey: "key",
			ruleId: "rent",
			ruleName: "Rent",
			merchant: "grocer",
			cadence: "monthly",
			accountId: "checking",
			linkable: true,
			reason: "",
			assignments: [{ postingId: "a", date: "2026-01-15", amount: "30.00" }],
		};
		render(
			<RecurringPatterns
				findings={[recurringFinding("one", "a"), recurringFinding("two", "b")]}
				names={names}
				readOnly
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", {
				name: "Link repeating pattern for Grocer to an existing rule",
			}),
		);
		expect(screen.getByText("Matched occurrences")).toBeDefined();
		expect(
			screen.queryByRole("button", { name: "Link payments to rule" }),
		).toBeNull();
	});
});
