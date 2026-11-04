import {
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import type { SettleCandidateRow } from "@/api/generated/model/settleCandidateRow.ts";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import type { Transaction } from "../../domain/model.ts";
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

vi.mock("@/state/savedState.ts", () => ({
	useSavedAccounts: () => [],
}));

function bnplFinding(
	overrides: Partial<AnalysisFinding> = {},
): AnalysisFinding {
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
		evidence: [
			{
				code: "bnpl.provider",
				reason: "Afterpay appears.",
				postingIds: ["posting-1"],
			},
		],
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

function bankRow(overrides: Partial<Transaction> = {}): Transaction {
	return {
		...financialModelFixture.transactions[0]!,
		id: "void-1",
		name: "Bistro",
		amount: 50,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		kind: "posting",
		startDate: "2026-10-20",
		endDate: null,
		annualIncrease: 0,
		enabled: false,
		readOnly: true,
		claimRuleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
		pending: false,
		void: true,
		syncOwned: true,
		...overrides,
	};
}

function settleCandidate(
	overrides: Partial<SettleCandidateRow> = {},
): SettleCandidateRow {
	return {
		postingId: "settled-1",
		name: "Bistro dinner",
		amount: 58,
		date: "2026-10-21",
		dayGap: 1,
		amountDeltaCents: 800,
		descriptorChanged: false,
		recommended: true,
		...overrides,
	};
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

	it("queues a vanished hold with a posted match before BNPL", () => {
		const hold = bankRow();
		const suggestions = buildInsightSuggestions({
			findings: [bnplFinding({ postingId: hold.id })],
			postingId: hold.id,
			voidRow: hold,
			candidates: [settleCandidate()],
		});
		expect(suggestions.map((item) => item.kind)).toEqual(["void", "bnpl"]);
	});

	it("skips a vanished hold without a posted match", () => {
		const hold = bankRow();
		const suggestions = buildInsightSuggestions({
			findings: [],
			postingId: hold.id,
			voidRow: hold,
			candidates: [],
		});
		expect(suggestions).toEqual([]);
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

	it("merges a vanished hold into its posted charge", async () => {
		const onMergeVoid = vi.fn().mockResolvedValue(true);
		const hold = bankRow();
		const settled = settleCandidate();
		render(
			<TransactionInsightsPanel
				suggestions={buildInsightSuggestions({
					findings: [],
					postingId: hold.id,
					voidRow: hold,
					candidates: [settled],
				})}
				names={new Map([[hold.id, hold.name]])}
				readOnly={false}
				onDone={() => {}}
				onMergeVoid={onMergeVoid}
			/>,
		);
		expect(screen.getByText(/Did this hold post/)).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Merge and remove hold" }),
		);
		await waitFor(() =>
			expect(onMergeVoid).toHaveBeenCalledWith(settled.postingId),
		);
		expect(screen.getByText("All caught up")).toBeTruthy();
	});

	it("states when a recorded occurrence moves with the merge", () => {
		const hold = bankRow({
			claimRuleId: "living",
			claimOccurrenceDate: "2026-10-01",
		});
		render(
			<TransactionInsightsPanel
				suggestions={buildInsightSuggestions({
					findings: [],
					postingId: hold.id,
					voidRow: hold,
					candidates: [settleCandidate()],
				})}
				names={new Map([["living", "Everyday living"]])}
				readOnly={false}
				onDone={() => {}}
				onMergeVoid={vi.fn().mockResolvedValue(true)}
			/>,
		);
		expect(
			screen.getByText(/records the occurrence of Everyday living/),
		).toBeTruthy();
	});

	it("states when the posted charge already records an occurrence", () => {
		const hold = bankRow({
			claimRuleId: "living",
			claimOccurrenceDate: "2026-10-01",
		});
		const settled = settleCandidate({
			claimRuleId: "living",
			claimOccurrenceDate: "2026-10-01",
		});
		render(
			<TransactionInsightsPanel
				suggestions={buildInsightSuggestions({
					findings: [],
					postingId: hold.id,
					voidRow: hold,
					candidates: [settled],
				})}
				names={new Map([["living", "Everyday living"]])}
				readOnly={false}
				onDone={() => {}}
				onMergeVoid={vi.fn().mockResolvedValue(true)}
			/>,
		);
		expect(screen.getByText(/already records an occurrence/)).toBeTruthy();
	});

	it("picks among several posted matches", async () => {
		const onMergeVoid = vi.fn().mockResolvedValue(true);
		const hold = bankRow();
		const first = settleCandidate();
		const second = settleCandidate({
			postingId: "settled-2",
			name: "Bistro lunch",
			amount: 51,
		});
		render(
			<TransactionInsightsPanel
				suggestions={buildInsightSuggestions({
					findings: [],
					postingId: hold.id,
					voidRow: hold,
					candidates: [first, second],
				})}
				names={new Map()}
				readOnly={false}
				onDone={() => {}}
				onMergeVoid={onMergeVoid}
			/>,
		);
		fireEvent.change(screen.getByLabelText("Posted as"), {
			target: { value: second.postingId },
		});
		fireEvent.click(
			screen.getByRole("button", { name: "Merge and remove hold" }),
		);
		await waitFor(() =>
			expect(onMergeVoid).toHaveBeenCalledWith(second.postingId),
		);
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
