// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeAccount } from "@/lib/projection/__fixtures__/accounts";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import { TransactionHistoryTable } from "./TransactionHistoryTable";

afterEach(cleanup);

describe("TransactionHistoryTable", () => {
	it("groups transactions under date headings", () => {
		const checking = makeAccount({
			id: "checking",
			label: "Checking",
			color: "#2563eb",
		});
		render(
			<TransactionHistoryTable
				postings={[
					makePosting({
						id: "deposit",
						label: "Deposit",
						frequency: "once",
						startDate: "2026-01-31",
						destinations: ["checking"],
						arithmetic: "100",
					}),
					makePosting({
						id: "purchase",
						label: "Purchase",
						frequency: "once",
						startDate: "2026-01-31",
						sourceAccountId: "checking",
						destinations: null,
						arithmetic: "25",
					}),
					makePosting({
						id: "older",
						label: "Older",
						frequency: "once",
						startDate: "2026-01-15",
					}),
				]}
				accounts={[checking]}
			/>,
		);

		expect(
			screen.getByRole("heading", { name: "Jan 31, 2026" }),
		).not.toBeNull();
		expect(screen.getByText("2 transactions")).not.toBeNull();
		expect(screen.getByText("Deposit")).not.toBeNull();
		expect(screen.getByText("Purchase")).not.toBeNull();
		expect(screen.getByText("+$100")).not.toBeNull();
		expect(screen.getByText("-$25")).not.toBeNull();
		expect(screen.getAllByText("Checking")[0].getAttribute("style")).toContain(
			"rgb(37, 99, 235)",
		);
		expect(screen.queryByRole("table")).toBeNull();
	});

	it("paginates by date without splitting a date group", () => {
		const postings = Array.from({ length: 11 }, (_, index) => {
			const day = String(index + 1).padStart(2, "0");
			return makePosting({
				id: `history-${day}`,
				label: `History ${day}`,
				frequency: "once",
				startDate: `2026-01-${day}`,
			});
		});
		render(<TransactionHistoryTable postings={postings} accounts={[]} />);

		expect(screen.getByText("History 11")).not.toBeNull();
		expect(screen.queryByText("History 01")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(screen.getByText("History 01")).not.toBeNull();
		expect(screen.getByText(/Page 2 of 2/)).not.toBeNull();
	});

	it("does not relabel an unresolved account as external", () => {
		render(
			<TransactionHistoryTable
				postings={[
					makePosting({
						id: "hidden-source-payment",
						label: "Payment",
						frequency: "once",
						startDate: "2026-01-31",
						sourceAccountId: "hidden-source",
						destinations: null,
						arithmetic: "10",
					}),
				]}
				accounts={[]}
			/>,
		);

		expect(screen.getByText("hidden-source")).not.toBeNull();
		expect(screen.getAllByText("External")).toHaveLength(1);
		expect(screen.getByText("-$10")).not.toBeNull();
	});

	it("resets to the first page when searching", () => {
		const postings = Array.from({ length: 11 }, (_, index) =>
			makePosting({
				id: `item-${index}`,
				label: index === 10 ? "Unique latest" : `Item ${index}`,
				frequency: "once",
				startDate: `2026-01-${String(index + 1).padStart(2, "0")}`,
			}),
		);
		render(<TransactionHistoryTable postings={postings} accounts={[]} />);
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		fireEvent.change(
			screen.getByPlaceholderText("Search transaction history..."),
			{
				target: { value: "Unique latest" },
			},
		);
		expect(screen.getByText("Unique latest")).not.toBeNull();
		expect(screen.getByText(/Page 1 of 1/)).not.toBeNull();
	});
});
