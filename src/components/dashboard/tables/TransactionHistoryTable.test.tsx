// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeAccount } from "@/lib/projection/__fixtures__/accounts";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import { TransactionHistoryTable } from "./TransactionHistoryTable";

afterEach(cleanup);

describe("TransactionHistoryTable", () => {
	it("sorts newest first and paginates twenty rows", () => {
		const postings = Array.from({ length: 21 }, (_, index) => {
			const day = String(index + 1).padStart(2, "0");
			return makePosting({
				id: `history-${day}`,
				label: `History ${day}`,
				frequency: "once",
				startDate: `2026-01-${day}`,
				arithmetic: String(index + 1),
			});
		});
		render(
			<TransactionHistoryTable
				postings={postings}
				accounts={[makeAccount({ id: "checking" })]}
				disabledPostingSet={new Set()}
				onToggle={() => {}}
			/>,
		);

		expect(screen.getByText("History 21")).not.toBeNull();
		expect(screen.queryByText("History 01")).toBeNull();
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(screen.getByText("History 01")).not.toBeNull();
		expect(
			(screen.getByRole("button", { name: "Next" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});

	it("resets to the first page when searching", () => {
		const postings = Array.from({ length: 21 }, (_, index) =>
			makePosting({
				id: `item-${index}`,
				label: index === 20 ? "Unique latest" : `Item ${index}`,
				frequency: "once",
				startDate: `2026-01-${String(index + 1).padStart(2, "0")}`,
			}),
		);
		render(
			<TransactionHistoryTable
				postings={postings}
				accounts={[]}
				disabledPostingSet={new Set()}
				onToggle={() => {}}
			/>,
		);
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

	it("clamps the stored page when history shrinks", () => {
		const makeHistory = (count: number) =>
			Array.from({ length: count }, (_, index) =>
				makePosting({
					id: `reload-${index}`,
					label: `Reload ${index}`,
					frequency: "once",
					startDate: `${2026 + index}-01-01`,
				}),
			);
		const props = {
			accounts: [],
			disabledPostingSet: new Set<string>(),
			onToggle: () => {},
		};
		const { rerender } = render(
			<TransactionHistoryTable postings={makeHistory(41)} {...props} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		fireEvent.click(screen.getByRole("button", { name: "Next" }));
		expect(screen.getByText(/Page 3 of 3/)).not.toBeNull();

		rerender(<TransactionHistoryTable postings={makeHistory(1)} {...props} />);
		expect(screen.getByText(/Page 1 of 1/)).not.toBeNull();
		rerender(<TransactionHistoryTable postings={makeHistory(41)} {...props} />);
		expect(screen.getByText(/Page 1 of 3/)).not.toBeNull();
		expect(screen.getByText("Reload 40")).not.toBeNull();
	});
});
