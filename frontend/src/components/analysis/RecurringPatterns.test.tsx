import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import type { PatternToExistingRulePreview } from "@/api/generated/model/patternToExistingRulePreview.ts";
import type { PatternToNewRulePreview } from "@/api/generated/model/patternToNewRulePreview.ts";
import { RecurringPatterns } from "./RecurringPatterns.tsx";

const reviewMutate = vi.hoisted(() => vi.fn());
const dismissMutate = vi.hoisted(() => vi.fn());
const createMutate = vi.hoisted(() => vi.fn());
const addMutate = vi.hoisted(() => vi.fn());
const previewState = vi.hoisted(() => ({
	data: undefined as PatternToNewRulePreview | undefined,
	isPending: false,
	isError: false,
}));
const existingRulePreviewState = vi.hoisted(() => ({
	data: undefined as PatternToExistingRulePreview | undefined,
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
	usePatternToNewRulePreview: () => previewState,
	useCreatePatternToNewRule: () => ({
		mutate: createMutate,
		isPending: false,
	}),
	usePatternToExistingRulePreview: () => existingRulePreviewState,
	useAddPatternToExistingRule: () => ({
		mutate: addMutate,
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

function creatablePreview(): PatternToNewRulePreview {
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
		creatable: true,
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
	} as PatternToNewRulePreview;
}

const names = new Map([
	["a", "Grocer"],
	["b", "Grocer"],
]);

beforeEach(() => {
	previewState.data = undefined;
	previewState.isPending = false;
	previewState.isError = false;
	existingRulePreviewState.data = undefined;
	existingRulePreviewState.isPending = false;
	existingRulePreviewState.isError = false;
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
		previewState.data = creatablePreview();
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
		createMutate.mockImplementation(
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
		expect(createMutate).toHaveBeenCalledWith(
			{ id: "one" },
			expect.objectContaining({}),
		);
		expect(screen.getByText(/Forecast rule “Grocer” created/)).toBeDefined();
	});
	it("explains plans that cannot become rules yet", () => {
		previewState.data = {
			...creatablePreview(),
			creatable: false,
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
	it("adds confirmed payments to an existing rule", () => {
		existingRulePreviewState.data = {
			findingId: "one",
			patternKey: "key",
			ruleId: "rent",
			ruleName: "Rent",
			merchant: "grocer",
			cadence: "monthly",
			accountId: "checking",
			claimable: true,
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
		addMutate.mockImplementation(
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
		expect(addMutate).toHaveBeenCalledWith(
			expect.objectContaining({ ruleId: "rent" }),
			expect.objectContaining({}),
		);
		expect(screen.getAllByText(/an occurrence/).length).toBeGreaterThan(0);
	});
	it("hides the link action in a read-only dialog", () => {
		existingRulePreviewState.data = {
			findingId: "one",
			patternKey: "key",
			ruleId: "rent",
			ruleName: "Rent",
			merchant: "grocer",
			cadence: "monthly",
			accountId: "checking",
			claimable: true,
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
