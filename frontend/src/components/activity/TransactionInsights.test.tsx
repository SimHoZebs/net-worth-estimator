import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import {
	buildInsightSuggestions,
	TransactionInsightsPanel,
	TransactionInsightsTrigger,
} from "./TransactionInsights.tsx";

const reviewMutate = vi.hoisted(() => vi.fn());
const dismissMutate = vi.hoisted(() => vi.fn());

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
	usePatternToNewRulePreview: () => ({
		data: undefined,
		isPending: false,
		isError: false,
	}),
	usePatternToExistingRulePreview: () => ({
		data: undefined,
		isPending: false,
		isError: false,
	}),
	useCreatePatternToNewRule: () => ({ mutate: vi.fn(), isPending: false }),
	useAddPatternToExistingRule: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/state/workspaceResources.ts", () => ({
	useTransactionCatalog: () => ({ data: { items: [] } }),
}));

vi.mock("@/state/savedRows.ts", () => ({
	useSavedAccounts: () => [],
}));

function bnplFinding(overrides: Partial<AnalysisFinding> = {}): AnalysisFinding {
	return {
		id: "bnpl-1",
		postingId: "posting-1",
		kind: "bnpl",
		provider: "afterpay",
		product: "",
		role: "outflow",
		strength: "strong",
		status: "active",
		stale: false,
		dismissed: false,
		runId: "run-1",
		feedbackRevision: 1,
		evidence: [{ code: "bnpl.provider", reason: "Afterpay appears.", postingIds: ["posting-1"] }],
		...overrides,
	} as AnalysisFinding;
}

function recurringFinding(
	id: string,
	postingId: string,
	overrides: Partial<AnalysisFinding> = {},
): AnalysisFinding {
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
		runId: "run-1",
		feedbackRevision: 1,
		evidence: [
			{ code: "recurring.cadence", reason: "test", postingIds: ["a", "b"] },
		],
		...overrides,
	} as AnalysisFinding;
}

beforeEach(() => {
	vi.stubGlobal("crypto", { randomUUID: () => "request-id" });
});

afterEach(() => {
	cleanup();
	vi.unstubAllGlobals();
	reviewMutate.mockReset();
	dismissMutate.mockReset();
});

describe("buildInsightSuggestions", () => {
	it("queues a pending BNPL finding before a repeating pattern", () => {
		const suggestions = buildInsightSuggestions({
			findings: [
				recurringFinding("rec-1", "a"),
				bnplFinding({ postingId: "posting-1" }),
			],
			postingId: "posting-1",
		});
		// The recurring fixture names other postings, so only BNPL queues.
		expect(suggestions.map((item) => item.kind)).toEqual(["bnpl"]);
	});

	it("queues a repeating pattern that touches the current posting", () => {
		const findings = [
			recurringFinding("rec-1", "a", {
				postingId: "posting-1",
				evidence: [
					{
						code: "recurring.cadence",
						reason: "test",
						postingIds: ["posting-1", "posting-2"],
					},
				],
			}),
			recurringFinding("rec-2", "posting-2", {
				evidence: [
					{
						code: "recurring.cadence",
						reason: "test",
						postingIds: ["posting-1", "posting-2"],
					},
				],
			}),
		];
		const suggestions = buildInsightSuggestions({
			findings,
			postingId: "posting-1",
		});
		expect(suggestions.map((item) => item.kind)).toEqual(["recurring"]);
	});

	it("skips decided, dismissed, and stale findings", () => {
		const decidedWithDuration = bnplFinding({
			review: {
				decision: "confirmed",
				provider: "afterpay",
				answeredAt: 1,
				duration: { count: 4, unit: "months" },
			},
		});
		const dismissed = bnplFinding({ id: "bnpl-2", dismissed: true });
		const stale = bnplFinding({ id: "bnpl-3", stale: true });
		expect(
			buildInsightSuggestions({
				findings: [decidedWithDuration, dismissed, stale],
				postingId: "posting-1",
			}),
		).toEqual([]);
	});

	it("queues a confirmed plan still missing its length", () => {
		const confirmed = bnplFinding({
			review: { decision: "confirmed", provider: "afterpay", answeredAt: 1 },
		});
		const suggestions = buildInsightSuggestions({
			findings: [confirmed],
			postingId: "posting-1",
		});
		expect(suggestions.map((item) => item.kind)).toEqual(["bnpl"]);
	});
});

describe("TransactionInsightsTrigger", () => {
	it("renders nothing without pending suggestions", () => {
		const { container } = render(
			<TransactionInsightsTrigger count={0} onClick={() => {}} />,
		);
		expect(container.firstChild).toBeNull();
	});

	it("announces the pending count", () => {
		render(<TransactionInsightsTrigger count={2} onClick={() => {}} />);
		expect(
			screen.getByRole("button", { name: "Review 2 suggestions" }),
		).toBeTruthy();
	});
});

describe("TransactionInsightsPanel", () => {
	it("asks one question at a time with quiet actions", () => {
		render(
			<TransactionInsightsPanel
				suggestions={buildInsightSuggestions({
					findings: [bnplFinding()],
					postingId: "posting-1",
				})}
				names={new Map([["posting-1", "Afterpay"]])}
				readOnly={false}
				onDone={() => {}}
			/>,
		);
		expect(screen.getByText(/buy now, pay later/)).toBeTruthy();
		expect(screen.getByRole("button", { name: "No" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Yes" })).toBeTruthy();
		expect(screen.getByRole("button", { name: "Not now" })).toBeTruthy();
		expect(screen.getByText("1 to review")).toBeTruthy();
	});

	it("rejects the detection on No", () => {
		reviewMutate.mockImplementation(
			(_args: unknown, options?: { onSuccess?: () => void }) => {
				options?.onSuccess?.();
			},
		);
		render(
			<TransactionInsightsPanel
				suggestions={buildInsightSuggestions({
					findings: [bnplFinding()],
					postingId: "posting-1",
				})}
				names={new Map()}
				readOnly={false}
				onDone={() => {}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "No" }));
		expect(reviewMutate).toHaveBeenCalledWith(
			expect.objectContaining({
				input: expect.objectContaining({ action: "reject" }),
			}),
			expect.any(Object),
		);
		expect(screen.getByText("All caught up")).toBeTruthy();
	});

	it("defers the detection on Not now", () => {
		dismissMutate.mockImplementation(
			(_args: unknown, options?: { onSuccess?: () => void }) => {
				options?.onSuccess?.();
			},
		);
		render(
			<TransactionInsightsPanel
				suggestions={buildInsightSuggestions({
					findings: [bnplFinding()],
					postingId: "posting-1",
				})}
				names={new Map()}
				readOnly={false}
				onDone={() => {}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Not now" }));
		expect(dismissMutate).toHaveBeenCalledWith(
			expect.objectContaining({ dismissed: true }),
			expect.any(Object),
		);
		expect(screen.getByText("All caught up")).toBeTruthy();
	});

	it("collects the plan length after Yes", () => {
		reviewMutate.mockImplementation(
			(_args: unknown, options?: { onSuccess?: () => void }) => {
				options?.onSuccess?.();
			},
		);
		render(
			<TransactionInsightsPanel
				suggestions={buildInsightSuggestions({
					findings: [bnplFinding()],
					postingId: "posting-1",
				})}
				names={new Map()}
				readOnly={false}
				onDone={() => {}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Yes" }));
		expect(screen.getByLabelText("Plan length")).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Plan length"), {
			target: { value: "6" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save" }));
		expect(reviewMutate).toHaveBeenLastCalledWith(
			expect.objectContaining({
				input: expect.objectContaining({
					action: "set-duration",
					duration: { count: 6, unit: "months" },
				}),
			}),
			expect.any(Object),
		);
	});

	it("opens a confirmed plan at the duration step", () => {
		render(
			<TransactionInsightsPanel
				suggestions={buildInsightSuggestions({
					findings: [
						bnplFinding({
							review: {
								decision: "confirmed",
								provider: "afterpay",
								answeredAt: 1,
							},
						}),
					],
					postingId: "posting-1",
				})}
				names={new Map()}
				readOnly={false}
				onDone={() => {}}
			/>,
		);
		expect(screen.getByLabelText("Plan length")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
	});

	it("completes when the queue is empty", () => {
		const onDone = vi.fn();
		render(
			<TransactionInsightsPanel
				suggestions={[]}
				names={new Map()}
				readOnly={false}
				onDone={onDone}
			/>,
		);
		expect(screen.getByText("All caught up")).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Done" }));
		expect(onDone).toHaveBeenCalledOnce();
	});
});
