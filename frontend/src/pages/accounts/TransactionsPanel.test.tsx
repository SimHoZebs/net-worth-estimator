import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransferLink } from "../../api/generated/model/transferLink.ts";
import type { Account, Transaction } from "../../domain/model.ts";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { TransactionsPanel } from "./TransactionsPanel.tsx";

const linkState = vi.hoisted(() => ({
	links: [] as TransferLink[],
	dataAvailable: true,
	isError: false,
	enabled: true,
}));

vi.mock("../../state/analyses.ts", () => ({
	useTransferLinks: (enabled: boolean) => {
		linkState.enabled = enabled;
		return {
			data: linkState.dataAvailable ? { links: linkState.links } : undefined,
			isSuccess: linkState.dataAvailable && !linkState.isError,
			isError: linkState.isError,
		};
	},
}));
vi.mock("../../components/activity/TransactionDetail.tsx", () => ({
	TransactionDetail: () => null,
}));

const accounts: Account[] = [
	{
		...financialModelFixture.accounts[0]!,
		id: "checking",
		name: "Checking",
	},
	{
		...financialModelFixture.accounts[1]!,
		id: "savings",
		name: "Savings",
	},
];

function transaction(
	id: string,
	overrides: Partial<Transaction> = {},
): Transaction {
	return {
		...financialModelFixture.transactions[0]!,
		id,
		name: id,
		kind: "transaction",
		amount: 25,
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
		...overrides,
	};
}

function renderPanel(
	transactions: Transaction[],
	options: { ruleCadence?: Map<string, string> } = {},
) {
	return render(
		<TransactionsPanel
			transactions={transactions}
			accounts={accounts}
			startDate="2026-11-01"
			readOnly={false}
			ruleCadence={options.ruleCadence}
		/>,
	);
}

function rowButton(name: string): HTMLElement {
	return screen.getByRole("button", { name: `View ${name} on Nov 20, 2026` });
}

beforeEach(() => {
	linkState.links = [];
	linkState.dataAvailable = true;
	linkState.isError = false;
	linkState.enabled = true;
});

describe("transactions panel business logos", () => {
	it.each([
		{
			name: "outflow",
			overrides: { fromId: "checking", toId: null },
			arrow: "lucide-arrow-up-right",
			amount: "−$25",
			tone: "bg-warning-bg",
		},
		{
			name: "inflow",
			overrides: { fromId: null, toId: "checking" },
			arrow: "lucide-arrow-down-left",
			amount: "+$25",
			tone: "bg-success-bg",
		},
	])(
		"keeps the $name arrow while loading and adds a visible sign with the logo",
		({ overrides, arrow, amount, tone }) => {
			const { container } = renderPanel([
				transaction("Spotify", {
					...overrides,
					recognizedBusinessKey: "spotify",
				}),
			]);
			const icon = container.querySelector(
				"[data-transaction-icon]",
			) as HTMLElement;
			const image = icon.querySelector("img") as HTMLImageElement;
			expect(icon.className).toContain("size-8");
			expect(icon.className).toContain("rounded-full");
			expect(icon.className).toContain(tone);
			expect(icon.querySelector(`svg.${arrow}`)).not.toBeNull();
			expect(image.getAttribute("width")).toBe("16");
			expect(image.getAttribute("height")).toBe("16");
			expect(image.getAttribute("alt")).toBe("");
			expect(image.getAttribute("aria-hidden")).toBe("true");
			expect(screen.getByText(amount)).toBeTruthy();

			fireEvent.load(image);
			expect(icon.querySelector("svg")).toBeNull();
			expect(screen.getByText(amount)).toBeTruthy();
		},
	);

	it("keeps the generic arrow and unsigned amount until transfer links are available", () => {
		linkState.dataAvailable = false;
		const { container, rerender } = renderPanel([
			transaction("Spotify", { recognizedBusinessKey: "spotify" }),
		]);
		const icon = container.querySelector(
			"[data-transaction-icon]",
		) as HTMLElement;
		expect(icon.querySelector("img")).toBeNull();
		expect(icon.querySelector("svg.lucide-arrow-up-right")).not.toBeNull();
		expect(screen.getByText("$25")).toBeTruthy();

		linkState.dataAvailable = true;
		rerender(
			<TransactionsPanel
				transactions={[
					transaction("Spotify", { recognizedBusinessKey: "spotify" }),
				]}
				accounts={accounts}
				startDate="2026-11-01"
				readOnly={false}
			/>,
		);
		expect(icon.querySelector("img")).not.toBeNull();
		expect(screen.getByText("−$25")).toBeTruthy();
	});

	it("keeps generic arrows after a transfer-link error without data, then accepts cached data", () => {
		linkState.dataAvailable = false;
		linkState.isError = true;
		const { container, rerender } = renderPanel([
			transaction("Spotify", { recognizedBusinessKey: "spotify" }),
		]);
		expect(linkState.enabled).toBe(true);
		expect(container.querySelector("[data-transaction-icon] img")).toBeNull();
		expect(container.querySelector("svg.lucide-arrow-up-right")).not.toBeNull();
		expect(screen.getByText("$25")).toBeTruthy();

		linkState.dataAvailable = true;
		rerender(
			<TransactionsPanel
				transactions={[
					transaction("Spotify", { recognizedBusinessKey: "spotify" }),
				]}
				accounts={accounts}
				startDate="2026-11-01"
				readOnly={false}
			/>,
		);
		expect(
			container.querySelector("[data-transaction-icon] img"),
		).not.toBeNull();
		expect(screen.getByText("−$25")).toBeTruthy();
	});

	it.each([
		{ name: "empty", rows: [] },
		{
			name: "recurring",
			rows: [
				transaction("schedule", {
					kind: "schedule",
					recognizedBusinessKey: "chase",
				}),
			],
		},
		{ name: "all-unknown", rows: [transaction("unknown")] },
	])("does not request transfer links for an $name page", ({ rows }) => {
		renderPanel(rows);
		expect(linkState.enabled).toBe(false);
	});

	it("uses cached transfer links after an error and suppresses every confirmed leg without changing direction or subtitles", () => {
		linkState.isError = true;
		linkState.links = [
			{ legA: "linked-out", legB: "linked-in" } as TransferLink,
		];
		const { container } = renderPanel(
			[
				transaction("transfer", {
					name: "Transfer",
					fromId: "checking",
					toId: "savings",
					amount: 40,
					recognizedBusinessKey: "chase",
				}),
				transaction("linked-out", {
					name: "Linked out",
					amount: 30,
					recognizedBusinessKey: "paypal",
				}),
				transaction("linked-in", {
					name: "Linked in",
					fromId: null,
					toId: "checking",
					amount: 30,
					recognizedBusinessKey: "paypal",
				}),
				transaction("schedule", {
					name: "Schedule",
					kind: "schedule",
					amount: 50,
					recognizedBusinessKey: "chase",
				}),
				transaction("unknown", {
					name: "Unknown",
					fromId: null,
					toId: "checking",
					amount: 20,
				}),
			],
			{ ruleCadence: new Map([["schedule", "Monthly"]]) },
		);
		expect(container.querySelector("[data-transaction-icon] img")).toBeNull();
		const icons = Array.from(
			container.querySelectorAll("[data-transaction-icon]"),
		);
		expect(
			icons.map((icon) => icon.querySelector("svg")?.classList[1]),
		).toEqual([
			"lucide-arrow-right",
			"lucide-arrow-up-right",
			"lucide-arrow-down-left",
			"lucide-arrow-up-right",
			"lucide-arrow-down-left",
		]);
		const transferRow = rowButton("Transfer").closest("tr")!;
		expect(within(transferRow).getByText("Checking → Savings")).toBeTruthy();
		expect(within(transferRow).getByText("$40")).toBeTruthy();
		const linkedOutRow = rowButton("Linked out").closest("tr")!;
		expect(within(linkedOutRow).getByText("Checking")).toBeTruthy();
		expect(within(linkedOutRow).getByText("$30")).toBeTruthy();
		const linkedInRow = rowButton("Linked in").closest("tr")!;
		expect(within(linkedInRow).getByText("Checking")).toBeTruthy();
		expect(within(linkedInRow).getByText("$30")).toBeTruthy();
		const scheduleRow = screen
			.getByRole("button", { name: "View Schedule on Monthly" })
			.closest("tr")!;
		expect(within(scheduleRow).getAllByText("Monthly")).toHaveLength(2);
		expect(within(scheduleRow).getByText("$50")).toBeTruthy();
		expect(screen.getByText("$20")).toBeTruthy();
	});

	it.each([
		{ fromId: "checking", toId: null, amount: "−Varies" },
		{ fromId: null, toId: "checking", amount: "+Varies" },
	])(
		"keeps direction visible when a recognized amount is $amount",
		({ fromId, toId, amount }) => {
			renderPanel([
				transaction("Spotify", {
					fromId,
					toId,
					amountKnown: false,
					recognizedBusinessKey: "spotify",
				}),
			]);
			expect(screen.getByText(amount)).toBeTruthy();
		},
	);

	it("keeps recognized zero amounts unchanged and falls back to the arrow on asset failure", () => {
		const { container } = renderPanel([
			transaction("Zero", {
				name: "Zero",
				amount: 0,
				recognizedBusinessKey: "spotify",
			}),
		]);
		expect(screen.getByText("$0")).toBeTruthy();
		fireEvent.error(container.querySelector("img") as HTMLImageElement);
		const icon = container.querySelector(
			"[data-transaction-icon]",
		) as HTMLElement;
		expect(icon.querySelector("img")).toBeNull();
		expect(icon.querySelector("svg.lucide-arrow-up-right")).not.toBeNull();
		expect(screen.getByText("$0")).toBeTruthy();
	});
});
