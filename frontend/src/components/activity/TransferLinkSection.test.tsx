// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "../../api/generated/model/analysisFinding.ts";
import type { TransferLink } from "../../api/generated/model/transferLink.ts";
import type { Account, Transaction } from "../../domain/model.ts";
import { ApiHttpError } from "../../api/http.ts";
import {
	resetNotifications,
	useNotifications,
} from "../../state/notifications.ts";
import {
	resolveTransferPeer,
	TransferLinkSection,
} from "./TransferLinkSection.tsx";

const findingsMock = vi.hoisted(() => vi.fn());
const linksMock = vi.hoisted(() => vi.fn());
const confirmMutate = vi.hoisted(() => vi.fn());
const confirmMock = vi.hoisted(() => vi.fn());
const removeMutate = vi.hoisted(() => vi.fn());
const removeMock = vi.hoisted(() => vi.fn());
const transactionsMock = vi.hoisted(() => vi.fn());
const accountsMock = vi.hoisted(() => vi.fn());
const readOnlyMock = vi.hoisted(() => vi.fn());

vi.mock("../../state/analyses.ts", () => ({
	useAnalysisFindings: findingsMock,
	useTransferLinks: linksMock,
	useConfirmTransferPair: confirmMock,
	useRemoveTransferLinkByLeg: removeMock,
}));

vi.mock("../../state/savedState.ts", () => ({
	useSavedTransactions: transactionsMock,
	useSavedAccounts: accountsMock,
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

function savedTransaction(overrides: Partial<Transaction>): Transaction {
	return {
		id: "leg-1",
		name: "Checking outflow",
		amount: 500,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		kind: "transaction",
		startDate: "2026-10-20",
		endDate: null,
		annualIncrease: 0,
		enabled: true,
		readOnly: false,
		claimScheduleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
		void: false,
		...overrides,
	};
}

function savedAccount(id: string, name: string): Account {
	return { id, name } as Account;
}

function mockSection({
	findings = [] as AnalysisFinding[],
	links = [] as TransferLink[],
	transactions = [] as Transaction[],
	accounts = [] as Account[],
	readOnly = false,
	confirm = {},
	remove = {},
}: {
	findings?: AnalysisFinding[];
	links?: TransferLink[];
	transactions?: Transaction[];
	accounts?: Account[];
	readOnly?: boolean;
	confirm?: object;
	remove?: object;
} = {}) {
	findingsMock.mockReturnValue({ data: { findings }, isError: false });
	linksMock.mockReturnValue({ data: { links }, isError: false });
	transactionsMock.mockReturnValue(transactions);
	accountsMock.mockReturnValue(accounts);
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

function outflowPair() {
	const self = savedTransaction({});
	const peer = savedTransaction({
		id: "peer-1",
		name: "Loan payment",
		fromId: null,
		toId: "mortgage",
	});
	const accounts = [
		savedAccount("checking", "Everyday checking"),
		savedAccount("mortgage", "Home mortgage"),
	];
	return { self, peer, accounts };
}

afterEach(() => {
	cleanup();
	vi.resetAllMocks();
	resetNotifications();
});

beforeEach(() => {
	resetNotifications();
});

describe("resolveTransferPeer", () => {
	it("names the peer account the current leg does not share", () => {
		const { self, peer, accounts } = outflowPair();
		expect(
			resolveTransferPeer({
				transactionId: "leg-1",
				link: link(),
				transactions: [self, peer],
				accounts,
			}),
		).toEqual({
			peerId: "peer-1",
			peerName: "Loan payment",
			accountName: "Home mortgage",
		});
	});
	it("returns null without a link", () => {
		expect(
			resolveTransferPeer({
				transactionId: "leg-1",
				link: undefined,
				transactions: [],
				accounts: [],
			}),
		).toBeNull();
	});
	it("leaves unknown accounts null so callers fall back to the peer name", () => {
		const { self, peer } = outflowPair();
		expect(
			resolveTransferPeer({
				transactionId: "leg-1",
				link: link(),
				transactions: [self, peer],
				accounts: [],
			})?.accountName,
		).toBeNull();
	});
});

describe("TransferLinkSection", () => {
	it("renders nothing without a finding or link", () => {
		mockSection();
		const { container } = render(<TransferLinkSection transactionId="leg-1" />);
		expect(container.firstChild).toBeNull();
	});

	it("names the other side and unlinks by this leg", () => {
		const { self, peer, accounts } = outflowPair();
		mockSection({
			findings: [findingWithPeers("finding", "leg-1", ["peer-1"], "strong")],
			links: [link()],
			transactions: [self, peer],
			accounts,
		});
		render(<TransferLinkSection transactionId="leg-1" />);
		expect(screen.getByText("Transfer to Home mortgage")).toBeTruthy();
		expect(screen.getByText("Loan payment")).toBeTruthy();
		expect(screen.getByText(/Counted once as a transfer/)).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Unlink the confirmed transfer touching leg-1",
			}),
		);
		expect(removeMutate).toHaveBeenCalledWith(
			{ transactionId: "leg-1" },
			expect.objectContaining({ onError: expect.any(Function) }),
		);
	});

	it("names the source account on inflow legs", () => {
		const { accounts } = outflowPair();
		const self = savedTransaction({
			id: "leg-1",
			name: "Loan receipt",
			fromId: null,
			toId: "checking",
		});
		const peer = savedTransaction({
			id: "peer-1",
			name: "Checking payment",
			fromId: "mortgage",
			toId: null,
		});
		mockSection({
			links: [link()],
			transactions: [self, peer],
			accounts,
		});
		render(<TransferLinkSection transactionId="leg-1" />);
		expect(screen.getByText("Transfer from Home mortgage")).toBeTruthy();
		expect(screen.getByText("Checking payment")).toBeTruthy();
	});

	it("links a single peer with the observed finding", () => {
		const { self, peer, accounts } = outflowPair();
		mockSection({
			findings: [findingWithPeers("finding", "leg-1", ["peer-1"], "strong")],
			transactions: [self, peer],
			accounts,
		});
		render(<TransferLinkSection transactionId="leg-1" />);
		fireEvent.click(
			screen.getByRole("button", { name: "Link as transfer with peer-1" }),
		);
		expect(confirmMutate).toHaveBeenCalledWith(
			{
				id: "finding",
				peerTransactionId: "peer-1",
			},
			expect.objectContaining({ onError: expect.any(Function) }),
		);
	});

	it("picks the best-ranked peer first and confirms the reselection", () => {
		const { self, peer, accounts } = outflowPair();
		const second = savedTransaction({
			id: "peer-2",
			name: "Card payment",
			fromId: null,
			toId: "mortgage",
		});
		mockSection({
			findings: [
				findingWithPeers("finding", "leg-1", ["peer-1", "peer-2"], "moderate"),
			],
			transactions: [self, peer, second],
			accounts,
		});
		render(<TransferLinkSection transactionId="leg-1" />);
		expect(
			(screen.getByRole("radio", { name: /Loan payment/ }) as HTMLInputElement)
				.checked,
		).toBe(true);
		fireEvent.click(
			screen.getByRole("button", { name: "Link as transfer with peer-1" }),
		);
		expect(confirmMutate).toHaveBeenCalledWith(
			{
				id: "finding",
				peerTransactionId: "peer-1",
			},
			expect.objectContaining({ onError: expect.any(Function) }),
		);
		confirmMutate.mockClear();
		fireEvent.click(screen.getByRole("radio", { name: /Card payment/ }));
		fireEvent.click(
			screen.getByRole("button", { name: "Link as transfer with peer-2" }),
		);
		expect(confirmMutate).toHaveBeenCalledWith(
			{
				id: "finding",
				peerTransactionId: "peer-2",
			},
			expect.objectContaining({ onError: expect.any(Function) }),
		);
	});

	it("renders a 422 reason inline", () => {
		const { self, peer, accounts } = outflowPair();
		mockSection({
			findings: [findingWithPeers("finding", "leg-1", ["peer-1"], "strong")],
			transactions: [self, peer],
			accounts,
			confirm: {
				isError: true,
				error: new ApiHttpError({
					message: "Transfer pairs need opposite directions.",
					status: 422,
					detail: "Same-sign pairs are not supported as one movement.",
				}),
			},
		});
		render(<TransferLinkSection transactionId="leg-1" />);
		expect(screen.getByText(/Same-sign pairs are not supported/)).toBeTruthy();
		expect(
			screen.getByRole("button", { name: "Link as transfer with peer-1" }),
		).toBeTruthy();
	});

	it("reports other failures through the error toast", () => {
		const { self, peer, accounts } = outflowPair();
		mockSection({
			findings: [findingWithPeers("finding", "leg-1", ["peer-1"], "strong")],
			transactions: [self, peer],
			accounts,
		});
		confirmMutate.mockImplementation(
			(_args: unknown, options?: { onError?: (cause: unknown) => void }) => {
				options?.onError?.(new Error("The transfer pair could not be saved."));
			},
		);
		render(<TransferLinkSection transactionId="leg-1" />);
		fireEvent.click(
			screen.getByRole("button", { name: "Link as transfer with peer-1" }),
		);
		const toast = useNotifications
			.getState()
			.items.find((item) => item.key === "transfer-link");
		expect(toast?.kind).toBe("error");
		expect(toast?.message).toBe("The transfer pair could not be saved.");
		expect(
			screen.queryByText("The transfer pair could not be saved."),
		).toBeNull();
	});

	it("hides actions in read-only mode but keeps the status", () => {
		const { self, peer, accounts } = outflowPair();
		mockSection({
			findings: [findingWithPeers("finding", "leg-1", ["peer-1"], "strong")],
			links: [link()],
			transactions: [self, peer],
			accounts,
			readOnly: true,
		});
		const { container } = render(
			<TransferLinkSection transactionId="leg-1" readOnly />,
		);
		expect(screen.getByText("Transfer to Home mortgage")).toBeTruthy();
		expect(screen.getByText(/Counted once as a transfer/)).toBeTruthy();
		expect(container.querySelector("button")).toBeNull();
		cleanup();
		mockSection({
			findings: [
				findingWithPeers("finding", "leg-1", ["peer-1", "peer-2"], "moderate"),
			],
			transactions: [self, peer],
			accounts,
			readOnly: true,
		});
		const { container: picker } = render(
			<TransferLinkSection transactionId="leg-1" readOnly />,
		);
		expect(screen.getByText(/Counted once as a transfer/)).toBeTruthy();
		expect(picker.querySelector("button")).toBeNull();
		expect(picker.querySelector('input[type="radio"]')).toBeNull();
	});
});
