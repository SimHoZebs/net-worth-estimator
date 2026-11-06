// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "../../api/generated/model/analysisFinding.ts";
import {
	transferFindingsForEdge,
	TransferMatchNote,
} from "./TransferMatchNote.tsx";

vi.mock("../../state/analyses.ts", () => ({
	useAnalysisFindings: vi.fn(),
}));

import { useAnalysisFindings } from "../../state/analyses.ts";

const findingsMock = vi.mocked(useAnalysisFindings);

function finding(overrides: Partial<AnalysisFinding>): AnalysisFinding {
	return {
		id: "finding",
		analysisType: "transfer",
		runId: "run",
		analyzerVersion: "transfer-v1",
		inputRevision: 1,
		firstDetectedAt: 1,
		lastCheckedAt: 1,
		status: "active",
		stale: false,
		dismissed: false,
		feedbackRevision: 0,
		transactionId: "leg-1",
		kind: "transfer",
		provider: "",
		product: "internal-transfer",
		role: "outflow",
		strength: "strong",
		evidence: [],
		...overrides,
	};
}

function mockFindings(findings: AnalysisFinding[]) {
	findingsMock.mockReturnValue({
		data: { findings },
		isError: false,
	} as never);
}

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
});

describe("transferFindingsForEdge", () => {
	it("keeps only live transfer findings for the edge legs", () => {
		const kept = finding({ id: "kept", transactionId: "leg-1" });
		const candidates = [
			kept,
			finding({ id: "other-kind", kind: "bnpl", transactionId: "leg-1" }),
			finding({ id: "other-leg", transactionId: "leg-9" }),
			finding({ id: "dismissed", dismissed: true, transactionId: "leg-1" }),
			finding({
				id: "rejected",
				transactionId: "leg-1",
				review: { decision: "rejected" },
			} as Partial<AnalysisFinding>),
		];
		expect(transferFindingsForEdge(candidates, ["leg-1"])).toEqual([kept]);
	});
	it("ignores an empty edge", () => {
		expect(transferFindingsForEdge([finding({})], [])).toEqual([]);
	});
});

describe("TransferMatchNote", () => {
	it("states the once-counted transfer and a confirmed pair", () => {
		mockFindings([finding({ strength: "strong" })]);
		render(<TransferMatchNote transactionIds={["leg-1"]} transferCount={2} />);
		expect(
			screen.getByText(/Counted once as a transfer across 2 transactions/),
		).toBeTruthy();
		expect(
			screen.getByText(/Both sides of this transfer are observed/),
		).toBeTruthy();
	});
	it("marks ambiguous pairs as unsettled without review actions", () => {
		mockFindings([finding({ strength: "moderate" })]);
		const { container } = render(
			<TransferMatchNote transactionIds={["leg-1"]} transferCount={1} />,
		);
		expect(screen.getByText(/not settled yet/)).toBeTruthy();
		expect(container.querySelector("button")).toBeNull();
	});
	it("says when no opposite leg is confirmed", () => {
		mockFindings([]);
		render(<TransferMatchNote transactionIds={["leg-1"]} transferCount={1} />);
		expect(screen.getByText(/No matching opposite transfer/)).toBeTruthy();
	});
});
