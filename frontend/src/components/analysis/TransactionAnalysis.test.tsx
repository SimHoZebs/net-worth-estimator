import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { TransactionAnalysisPanel } from "./TransactionAnalysis.tsx";

const findingsState = vi.hoisted(() => ({
	findings: [] as AnalysisFinding[],
}));

vi.mock("@/state/analyses.ts", () => ({
	useAnalysisFindings: () => ({
		data: { findings: findingsState.findings },
		isError: false,
	}),
	useReviewAnalysisFinding: () => ({
		mutate: vi.fn(),
		isPending: false,
		isError: false,
	}),
}));

function bnplFinding(
	overrides: Partial<AnalysisFinding> = {},
): AnalysisFinding {
	return {
		id: "finding-1",
		runId: "run-1",
		feedbackRevision: 1,
		strength: "strong",
		stale: false,
		dismissed: false,
		status: "active",
		kind: "bnpl",
		provider: "klarna",
		product: "",
		role: "outflow",
		postingId: "posting-1",
		evidence: [],
		...overrides,
	} as AnalysisFinding;
}

afterEach(() => {
	cleanup();
	findingsState.findings = [];
});

describe("TransactionAnalysisPanel quiet display", () => {
	it("shows a confirmed plan with its length inline", () => {
		findingsState.findings = [
			bnplFinding({
				review: {
					decision: "confirmed",
					provider: "klarna",
					answeredAt: 1,
					duration: { count: 6, unit: "weeks" },
				},
			}),
		];
		render(<TransactionAnalysisPanel postingId="posting-1" readOnly={false} />);
		expect(screen.getByText("Klarna · 6 weeks")).toBeTruthy();
	});

	it("hides a confirmed plan still missing its length (the queue collects it)", () => {
		findingsState.findings = [
			bnplFinding({
				review: { decision: "confirmed", provider: "klarna", answeredAt: 1 },
			}),
		];
		const { container } = render(
			<TransactionAnalysisPanel postingId="posting-1" readOnly={false} />,
		);
		expect(container.firstChild).toBeNull();
	});

	it("hides a pending question (the queue asks it)", () => {
		findingsState.findings = [bnplFinding()];
		const { container } = render(
			<TransactionAnalysisPanel postingId="posting-1" readOnly={false} />,
		);
		expect(container.firstChild).toBeNull();
	});

	it("keeps the compact badge line for read-only viewers", () => {
		findingsState.findings = [bnplFinding()];
		render(<TransactionAnalysisPanel postingId="posting-1" readOnly={true} />);
		expect(screen.getByText("Likely BNPL")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
		expect(screen.queryByRole("button", { name: "No" })).toBeNull();
	});
});
