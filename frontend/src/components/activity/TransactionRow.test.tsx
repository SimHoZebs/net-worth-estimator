import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransferLink } from "../../api/generated/model/transferLink.ts";
import type { AccountTransaction } from "../../domain/accountActivity.ts";
import type { Transaction } from "../../domain/model.ts";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { TransactionRow } from "./TransactionRow.tsx";

const linkState = vi.hoisted(() => ({
	links: [] as TransferLink[],
	dataAvailable: true,
	isError: false,
}));

vi.mock("../../state/analyses.ts", () => ({
	useTransferLinks: () => ({
		data: linkState.dataAvailable ? { links: linkState.links } : undefined,
		isError: linkState.isError,
	}),
}));
vi.mock("../../state/savedState.ts", () => ({
	useSavedAccounts: () => [],
	useSavedTransactions: () => [],
}));
vi.mock("../analysis/TransactionAnalysis.tsx", () => ({
	useTransactionBNPL: () => undefined,
}));

function occurrence(
	overrides: Partial<AccountTransaction> = {},
): AccountTransaction {
	return {
		id: "recorded-spotify",
		transactionId: "spotify",
		date: "2026-11-20",
		name: "Spotify",
		source: "historical",
		direction: "out",
		flow: "expense",
		counterparty: "External spending",
		from: "Checking",
		to: "External spending",
		amount: 12,
		requested: 12,
		shortfall: 0,
		constraint: null,
		excluded: false,
		pending: false,
		void: false,
		...overrides,
	};
}

function savedTransaction(overrides: Partial<Transaction> = {}): Transaction {
	return {
		...financialModelFixture.transactions[0]!,
		id: "spotify",
		name: "Spotify",
		kind: "transaction",
		amount: 12,
		amountKnown: true,
		fromId: "checking",
		toId: null,
		startDate: "2026-11-20",
		endDate: null,
		annualIncrease: 0,
		enabled: true,
		readOnly: false,
		claimScheduleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
		pending: false,
		void: false,
		recognizedBusinessKey: "spotify",
		...overrides,
	};
}

function renderRow(
	transaction: AccountTransaction,
	saved: Transaction | null = savedTransaction(),
	transferPeer?: Parameters<typeof TransactionRow>[0]["transferPeer"],
) {
	return render(
		<table>
			<tbody>
				<TransactionRow
					transaction={transaction}
					savedTransaction={saved}
					transferPeer={transferPeer}
					onEdit={vi.fn()}
				/>
			</tbody>
		</table>,
	);
}

beforeEach(() => {
	linkState.links = [];
	linkState.dataAvailable = true;
	linkState.isError = false;
});

describe("transaction row business logos", () => {
	it("keeps the direction arrow while loading, then shows the decorative logo", () => {
		const { container } = renderRow(occurrence());
		const icon = container.querySelector(
			"[data-transaction-icon]",
		) as HTMLElement;
		const image = icon.querySelector("img") as HTMLImageElement;
		expect(icon.className).toContain("relative");
		expect(icon.className).toContain("size-8");
		expect(icon.className).toContain("rounded-full");
		expect(icon.className).toContain("bg-warning-bg");
		expect(image.getAttribute("src")).toBe("/v1/assets/business-logos/spotify");
		expect(image.getAttribute("alt")).toBe("");
		expect(image.getAttribute("aria-hidden")).toBe("true");
		expect(image.getAttribute("width")).toBe("16");
		expect(image.getAttribute("height")).toBe("16");
		expect(image.className).toContain("opacity-0");
		expect(icon.querySelector("svg.lucide-arrow-up-right")).not.toBeNull();
		expect(screen.getByText("−$12.00")).toBeTruthy();

		fireEvent.load(image);
		expect(icon.querySelector("svg")).toBeNull();
		expect(icon.querySelector("img")?.className).not.toContain("opacity-0");
		expect(
			screen.getByRole("button", { name: "View Spotify on Nov 20, 2026" }),
		).toBeTruthy();
	});

	it.each([
		{ state: "pending", dataAvailable: false, isError: false },
		{ state: "failed", dataAvailable: false, isError: true },
	])(
		"keeps the generic arrow while transfer links are $state",
		({ dataAvailable, isError }) => {
			linkState.dataAvailable = dataAvailable;
			linkState.isError = isError;
			const { container } = renderRow(occurrence());
			expect(container.querySelector("[data-transaction-icon] img")).toBeNull();
			expect(
				container.querySelector("svg.lucide-arrow-up-right"),
			).not.toBeNull();
			expect(screen.getByText("−$12.00")).toBeTruthy();
		},
	);

	it("allows an unlinked logo from cached transfer data after an error", () => {
		linkState.isError = true;
		const { container } = renderRow(occurrence());
		expect(
			container
				.querySelector("[data-transaction-icon] img")
				?.getAttribute("src"),
		).toBe("/v1/assets/business-logos/spotify");
	});

	it("uses confirmed link membership when the parent peer is null", () => {
		linkState.isError = true;
		linkState.links = [{ legA: "spotify", legB: "peer" } as TransferLink];
		const { container } = renderRow(occurrence(), savedTransaction(), null);
		const icon = container.querySelector(
			"[data-transaction-icon]",
		) as HTMLElement;
		expect(icon.querySelector("img")).toBeNull();
		expect(icon.querySelector("svg.lucide-arrow-right-left")).not.toBeNull();
		expect(icon.className).toContain("bg-accent");
		expect(
			screen.getByRole("button", { name: "View Spotify on Nov 20, 2026" }),
		).toBeTruthy();
		expect(screen.getByText("−$12.00")).toBeTruthy();
	});

	it("uses only recognized personal saved rows for logo eligibility", () => {
		const unknown = renderRow(
			occurrence(),
			savedTransaction({ recognizedBusinessKey: undefined }),
		);
		expect(
			unknown.container.querySelector("[data-transaction-icon] img"),
		).toBeNull();
		expect(
			unknown.container.querySelector("svg.lucide-arrow-up-right"),
		).not.toBeNull();
		unknown.unmount();

		const schedule = renderRow(
			occurrence(),
			savedTransaction({ kind: "schedule" }),
		);
		expect(
			schedule.container.querySelector("[data-transaction-icon] img"),
		).toBeNull();
		expect(
			schedule.container.querySelector("svg.lucide-arrow-up-right"),
		).not.toBeNull();
	});

	it("restores the direction arrow and keeps the signed amount after an asset failure", () => {
		const { container } = renderRow(occurrence());
		fireEvent.error(container.querySelector("img") as HTMLImageElement);
		const icon = container.querySelector(
			"[data-transaction-icon]",
		) as HTMLElement;
		expect(icon.querySelector("img")).toBeNull();
		expect(icon.querySelector("svg.lucide-arrow-up-right")).not.toBeNull();
		expect(screen.getByText("−$12.00")).toBeTruthy();
	});

	it("keeps the transfer arrow, subtitle, tone, and signed amount for a resolved link", () => {
		const { container } = renderRow(occurrence(), savedTransaction(), {
			peerId: "peer",
			peerName: "Card payment",
			accountName: "Savings",
		});
		const icon = container.querySelector(
			"[data-transaction-icon]",
		) as HTMLElement;
		expect(icon.querySelector("img")).toBeNull();
		expect(icon.querySelector("svg.lucide-arrow-right-left")).not.toBeNull();
		expect(icon.className).toContain("bg-accent");
		expect(screen.getByText("To Savings")).toBeTruthy();
		expect(screen.getByText("−$12.00")).toBeTruthy();
		expect(
			screen.getByRole("button", {
				name: "View Spotify on Nov 20, 2026; money out to Savings",
			}),
		).toBeTruthy();
	});

	it("keeps the transfer arrow for a two-sided transfer with a recognized name", () => {
		const { container } = renderRow(
			occurrence({ flow: "transfer" }),
			savedTransaction({ toId: "savings" }),
		);
		const icon = container.querySelector(
			"[data-transaction-icon]",
		) as HTMLElement;
		expect(icon.querySelector("img")).toBeNull();
		expect(icon.querySelector("svg.lucide-arrow-right-left")).not.toBeNull();
		expect(screen.getByText("−$12.00")).toBeTruthy();
	});
});
