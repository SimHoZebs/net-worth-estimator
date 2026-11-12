// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "../../api/generated/model/analysisFinding.ts";
import type { TransferLink } from "../../api/generated/model/transferLink.ts";
import { ApiHttpError } from "../../api/http.ts";
import {
	transferFindingsForEdge,
	transferLinkForEdge,
	transferPeers,
	TransferMatchNote,
} from "./TransferMatchNote.tsx";

const findingsMock = vi.hoisted(() => vi.fn());
const linksMock = vi.hoisted(() => vi.fn());
const confirmMutate = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const removeMutate = vi.hoisted(() => vi.fn());
const removeMock = vi.hoisted(() => vi.fn());
const readOnlyMock = vi.hoisted(() => vi.fn());

vi.mock("../../state/analyses.ts", () => ({
	useAnalysisFindings: findingsMock,
	useTransferLinks: linksMock,
	useConfirmTransferPair: confirmMock,
	useRemoveTransferLinkByLeg: removeMock,
}));

vi.mock("../../state/useUserScope.ts", () => ({
	useUserReadOnly: readOnlyMock,
}));

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

function findingWithPeers(
	id: string,
	leg: string,
	peers: string[],
	strength: "strong" | "moderate",
): AnalysisFinding {
	return finding({
		id,
		transactionId: leg,
		strength,
		evidence: [
			{
				code: "transfer.exact-leg-match",
				reason: "Both legs are observed.",
				transactionIds: [leg, ...peers],
			},
		],
	});
}

function link(overrides: Partial<TransferLink> = {}): TransferLink {
	return {
		legA: "leg-1",
		legB: "peer-1",
		findingId: "finding",
		actor: "owner",
		createdAt: 1,
		...overrides,
	};
}

function mockNote({
	findings = [] as AnalysisFinding[],
	links = [] as TransferLink[],
	readOnly = false,
	confirm = {},
	remove = {},
}: {
	findings?: AnalysisFinding[];
	links?: TransferLink[];
	readOnly?: boolean;
	confirm?: object;
	remove?: object;
} = {}) {
	findingsMock.mockReturnValue({ data: { findings }, isError: false });
	linksMock.mockReturnValue({ data: { links }, isError: false });
	readOnlyMock.mockReturnValue(readOnly);
	confirmMock.mockReturnValue({
		mutate: confirmMutate,
		isPending: false,
		isError: false,
		error: null,
		...confirm,
	});
	removeMock.mockReturnValue({
		mutate: removeMutate,
		isPending: false,
		isError: false,
		error: null,
		...remove,
	});
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

describe("transferPeers", () => {
	it("drops the observed leg and keeps best-first order", () => {
		const peers = transferPeers(
			findingWithPeers("finding", "leg-1", ["peer-1", "peer-2"], "moderate"),
		);
		expect(peers).toEqual(["peer-1", "peer-2"]);
	});
	it("dedupes repeated ids across evidence entries", () => {
		const peers = transferPeers(
			finding({
				evidence: [
					{
						code: "transfer.exact-leg-match",
						reason: "Both legs are observed.",
						transactionIds: ["leg-1", "peer-1"],
					},
					{
						code: "transfer.ambiguous-legs",
						reason: "Several match.",
						transactionIds: ["leg-1", "peer-1", "peer-2"],
					},
				],
			}),
		);
		expect(peers).toEqual(["peer-1", "peer-2"]);
	});
});

describe("transferLinkForEdge", () => {
	it("matches a link touching either leg", () => {
		const links = [link({ legA: "peer-9", legB: "leg-2" })];
		expect(transferLinkForEdge(links, ["leg-1", "leg-2"])?.legB).toBe(
			"leg-2",
		);
		expect(transferLinkForEdge(links, ["leg-1"])).toBeUndefined();
	});
});

describe("TransferMatchNote", () => {
	it("states the once-counted transfer and a confirmed pair", () => {
		mockNote({ findings: [finding({ strength: "strong" })] });
		render(<TransferMatchNote transactionIds={["leg-1"]} transferCount={2} />);
		expect(
			screen.getByText(/Counted once as a transfer across 2 transactions/),
		).toBeTruthy();
		expect(
			screen.getByText(/Both sides of this transfer are observed/),
		).toBeTruthy();
	});
	it("links a strong single-peer finding to its peer", () => {
		mockNote({
			findings: [
				findingWithPeers("finding", "leg-1", ["peer-1"], "strong"),
			],
		});
		render(<TransferMatchNote transactionIds={["leg-1"]} transferCount={1} />);
		fireEvent.click(
			screen.getByRole("button", { name: "Link as transfer with peer-1" }),
		);
		expect(confirmMutate).toHaveBeenCalledWith({
			id: "finding",
			peerTransactionId: "peer-1",
		});
	});
	it("lists ambiguous candidates best-first and confirms the selection", () => {
		mockNote({
			findings: [
				findingWithPeers(
					"finding",
					"leg-1",
					["peer-1", "peer-2"],
					"moderate",
				),
			],
		});
		render(<TransferMatchNote transactionIds={["leg-1"]} transferCount={1} />);
		expect(screen.getByText(/not settled yet/)).toBeTruthy();
		expect(
			(screen.getByRole("radio", { name: "peer-1" }) as HTMLInputElement)
				.checked,
		).toBe(true);
		fireEvent.click(
			screen.getByRole("button", { name: "Link as transfer with peer-1" }),
		);
		expect(confirmMutate).toHaveBeenCalledWith({
			id: "finding",
			peerTransactionId: "peer-1",
		});
		confirmMutate.mockClear();
		fireEvent.click(screen.getByRole("radio", { name: "peer-2" }));
		fireEvent.click(
			screen.getByRole("button", { name: "Link as transfer with peer-2" }),
		);
		expect(confirmMutate).toHaveBeenCalledWith({
			id: "finding",
			peerTransactionId: "peer-2",
		});
	});
	it("unlinks the confirmed leg by its edge transaction", () => {
		mockNote({
			findings: [
				findingWithPeers("finding", "leg-1", ["peer-1"], "strong"),
			],
			links: [link()],
		});
		render(<TransferMatchNote transactionIds={["leg-1"]} transferCount={1} />);
		expect(screen.getByText(/Linked as transfer/)).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: /Link as transfer with/ }),
		).toBeNull();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Unlink the confirmed transfer touching leg-1",
			}),
		);
		expect(removeMutate).toHaveBeenCalledWith({ transactionId: "leg-1" });
	});
	it("renders a 422 reason inline without dismissing the finding", () => {
		mockNote({
			findings: [
				findingWithPeers("finding", "leg-1", ["peer-1"], "strong"),
			],
			confirm: {
				isError: true,
				error: new ApiHttpError({
					message:
						"The request needs valid values. Transfer pairs need opposite directions.",
					status: 422,
					detail:
						"Transfer pairs need opposite directions: both legs post the same sign, and same-sign pairs are not supported as one movement.",
				}),
			},
		});
		render(<TransferMatchNote transactionIds={["leg-1"]} transferCount={1} />);
		expect(screen.getByText(/same-sign pairs are not supported/)).toBeTruthy();
		expect(
			screen.getByText(/Both sides of this transfer are observed/),
		).toBeTruthy();
	});
	it("renders a 403 denial as a notice", () => {
		mockNote({
			findings: [
				findingWithPeers("finding", "leg-1", ["peer-1"], "strong"),
			],
			confirm: {
				isError: true,
				error: new ApiHttpError({
					message:
						"Saving is blocked while the server is read-only. Viewing is still available.",
					status: 403,
				}),
			},
		});
		render(<TransferMatchNote transactionIds={["leg-1"]} transferCount={1} />);
		expect(screen.getByText(/Saving is blocked/)).toBeTruthy();
	});
	it("hides actions in read-only mode", () => {
		mockNote({
			findings: [
				findingWithPeers(
					"finding",
					"leg-1",
					["peer-1", "peer-2"],
					"moderate",
				),
			],
			readOnly: true,
		});
		const { container } = render(
			<TransferMatchNote transactionIds={["leg-1"]} transferCount={1} />,
		);
		expect(screen.getByText(/not settled yet/)).toBeTruthy();
		expect(container.querySelector("button")).toBeNull();
		expect(container.querySelector('input[type="radio"]')).toBeNull();
	});
	it("says when no opposite leg is confirmed", () => {
		mockNote({ findings: [] });
		render(<TransferMatchNote transactionIds={["leg-1"]} transferCount={1} />);
		expect(screen.getByText(/No matching opposite transfer/)).toBeTruthy();
	});
});
