import { cleanup, fireEvent, render, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toAccountCard } from "../../domain/accountCards.ts";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import {
	activityProjection,
	transactionFixture,
	projectionFixture,
} from "../../mocks/projection.ts";
import { AccountDetailsModal } from "./AccountDetailsModal.tsx";

// Native modal focus and dismissal belong to Modal's browser coverage.
vi.mock("../Modal.tsx", async (importOriginal) => ({
	...(await importOriginal<typeof import("../Modal.tsx")>()),
	Modal: ({ title, children }: { title: string; children: ReactNode }) => (
		<section aria-label={title}>{children}</section>
	),
}));

// Selection assertions use a marker detail; editors keep browser coverage.
vi.mock("../activity/TransactionDetail.tsx", () => ({
	TransactionDetail: ({
		transaction,
	}: {
		transaction: { name: string; date: string };
	}) => (
		<p data-testid="selected-transaction" data-date={transaction.date}>
			{transaction.name}
		</p>
	),
}));

afterEach(cleanup);

beforeEach(() => {
	// jsdom has no scrollIntoView; the pager scrolls the table into view.
	window.HTMLElement.prototype.scrollIntoView ??= () => {};
});

describe("AccountDetailsModal", () => {
	it("keeps metrics semantic and searches transactions through a labeled input", () => {
		const projection = projectionFixture({
			transactions: [
				transactionFixture({
					transactionId: "living",
					name: "Everyday living",
					date: "2026-10-01",
					requested: 5400,
					realized: 5400,
					constraint: null,
				}),
			],
		});
		const card = toAccountCard({
			account: financialModelFixture.accounts[0]!,
			projection,
		});
		const view = render(
			<AccountDetailsModal
				card={card}
				accounts={financialModelFixture.accounts}
				transactions={financialModelFixture.transactions}
				startDate={financialModelFixture.startDate}
				readOnly={financialModelFixture.readOnly}
				projection={projection}
				onClose={() => {}}
			/>,
		);
		const term = view.getByText("Protected balance");
		expect(term.tagName).toBe("DT");
		expect(term.nextElementSibling?.tagName).toBe("DD");
		expect(term.closest("dl")).toBeTruthy();
		const search = view.getByLabelText("Search account transactions");
		expect(search.tagName).toBe("INPUT");
		fireEvent.change(search, { target: { value: "Everyday living" } });
		expect(
			view.getByRole("button", { name: /View Everyday living/ }),
		).toBeTruthy();
		expect(
			view.queryByRole("button", { name: /View Household payroll/ }),
		).toBeNull();
		fireEvent.change(search, { target: { value: "no such payment" } });
		expect(view.getByText("No matching transactions")).toBeTruthy();
	});

	it("preserves native pressed states and posted-only filtering", () => {
		const projection = projectionFixture({
			transactions: [
				transactionFixture({
					transactionId: "living",
					name: "Everyday living",
					date: "2026-10-01",
				}),
			],
		});
		const card = toAccountCard({
			account: financialModelFixture.accounts[0]!,
			projection,
		});
		const view = render(
			<AccountDetailsModal
				card={card}
				accounts={financialModelFixture.accounts}
				transactions={financialModelFixture.transactions}
				startDate={financialModelFixture.startDate}
				readOnly={financialModelFixture.readOnly}
				projection={projection}
				onClose={() => {}}
			/>,
		);
		const filters = within(
			view.getByRole("group", { name: "Filter by posting status" }),
		);
		const all = filters.getByRole("button", {
			name: "all",
		}) as HTMLButtonElement;
		const posted = filters.getByRole("button", {
			name: "posted",
		}) as HTMLButtonElement;
		expect(all.type).toBe("button");
		expect(all.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(posted);
		expect(all.getAttribute("aria-pressed")).toBe("false");
		expect(posted.getAttribute("aria-pressed")).toBe("true");
		expect(
			view.queryByRole("button", { name: /View Everyday living/ }),
		).toBeNull();
		expect(
			view.getAllByRole("button", { name: /View Household payroll/ }),
		).toHaveLength(3);
	});

	it("paginates long transaction lists client-side", () => {
		const projection = activityProjection();
		const card = toAccountCard({
			account: financialModelFixture.accounts[0]!,
			projection,
		});
		const view = render(
			<AccountDetailsModal
				card={card}
				accounts={financialModelFixture.accounts}
				transactions={financialModelFixture.transactions}
				startDate={financialModelFixture.startDate}
				readOnly={financialModelFixture.readOnly}
				projection={projection}
				onClose={() => {}}
			/>,
		);
		expect(view.getByRole("status").textContent).toMatch(
			/Showing 1–20 of \d+ transactions/,
		);
		fireEvent.click(
			view.getByRole("button", { name: "Next transaction page" }),
		);
		expect(view.getByRole("status").textContent).toMatch(/Showing 21–40 of/);
	});

	it("keeps an open transaction across data refreshes and closes it when its saved rule is gone", () => {
		const projection = activityProjection();
		const card = toAccountCard({
			account: financialModelFixture.accounts[0]!,
			projection,
		});
		const base = {
			card,
			accounts: financialModelFixture.accounts,
			transactions: financialModelFixture.transactions,
			startDate: financialModelFixture.startDate,
			readOnly: financialModelFixture.readOnly,
			projection,
			onClose: () => {},
		};
		const view = render(<AccountDetailsModal {...base} />);
		fireEvent.change(view.getByLabelText("Search account transactions"), {
			target: { value: "Everyday living" },
		});
		fireEvent.click(
			view.getAllByRole("button", { name: /View Everyday living/ })[0]!,
		);
		expect(view.getByTestId("selected-transaction").textContent).toContain(
			"Everyday living",
		);
		const selectedDate = view.getByTestId("selected-transaction").dataset.date;
		// An unrelated refresh arrives with brand-new identities but the same
		// records: the open detail stays on its row.
		const refresh = activityProjection();
		// An earlier occurrence shifts the index in every projected row id.
		refresh.transactions.unshift(
			transactionFixture({ transactionId: "earlier", date: "2026-09-25" }),
		);
		view.rerender(
			<AccountDetailsModal
				{...base}
				card={toAccountCard({
					account: financialModelFixture.accounts[0]!,
					projection: refresh,
				})}
				accounts={[...financialModelFixture.accounts]}
				transactions={[...financialModelFixture.transactions]}
				projection={refresh}
			/>,
		);
		expect(view.getByTestId("selected-transaction").textContent).toContain(
			"Everyday living",
		);
		expect(view.getByTestId("selected-transaction").dataset.date).toBe(
			selectedDate,
		);
		// The saved rule itself is gone: the detail closes instead of
		// showing a stale row.
		view.rerender(
			<AccountDetailsModal
				{...base}
				projection={refresh}
				transactions={financialModelFixture.transactions.filter(
					(saved) => saved.id !== "living",
				)}
			/>,
		);
		expect(view.queryByTestId("selected-transaction")).toBeNull();
	});
});
