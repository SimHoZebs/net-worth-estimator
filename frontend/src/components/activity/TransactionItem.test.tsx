import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Table, TableBody, TableCell, TableRow } from "../DataTable.tsx";
import { TransactionItemRow } from "./TransactionItem.tsx";
import { TransactionTable } from "./TransactionTable.tsx";

afterEach(cleanup);

describe("TransactionItemRow", () => {
	it("accepts explicit table framing without parent selectors", () => {
		render(
			<TransactionTable caption="Records" className="border-t-0">
				<TableRow>
					<TableCell>Record</TableCell>
				</TableRow>
			</TransactionTable>,
		);
		expect(screen.getByRole("table").classList.contains("border-t-0")).toBe(
			true,
		);
		expect(screen.getByRole("table").classList.contains("border-t")).toBe(
			false,
		);
	});

	it("owns its row, slots, and responsive elements inside a native table", () => {
		const onSelect = vi.fn();
		render(
			<Table aria-label="Transactions">
				<TableBody>
					<TransactionItemRow
						date={<time dateTime="2026-10-21">Oct 21</time>}
						icon={<svg aria-hidden="true" />}
						tone="inflow"
						title="Paycheck"
						amount={<strong>$100</strong>}
						actionLabel="View paycheck"
						onSelect={onSelect}
						dimmed
						slots={{
							subtitle: "Employer",
							mobile: "Oct 21",
							badges: <span>Pending</span>,
						}}
					/>
				</TableBody>
			</Table>,
		);
		const button = screen.getByRole("button", { name: "View paycheck" });
		const row = screen.getByRole("row");
		expect(row.tagName).toBe("TR");
		expect(row.classList.contains("border-b")).toBe(true);
		expect(row.classList.contains("bg-surface-2")).toBe(true);
		expect(screen.getByRole("rowheader").getAttribute("scope")).toBe("row");
		expect(
			button
				.querySelector("svg")
				?.parentElement?.classList.contains("bg-success-bg"),
		).toBe(true);
		expect(
			button
				.querySelector("svg")
				?.parentElement?.classList.contains("max-sm:hidden"),
		).toBe(true);
		expect(screen.getByText("Employer").classList.contains("text-xs")).toBe(
			true,
		);
		expect(
			screen
				.getByText("Pending")
				.parentElement?.classList.contains("flex-wrap"),
		).toBe(true);
		expect(button.className).not.toContain("[&");
		fireEvent.click(button);
		expect(onSelect).toHaveBeenCalledOnce();
	});

	it("keeps unavailable selection disabled", () => {
		const onSelect = vi.fn();
		render(
			<Table>
				<TableBody>
					<TransactionItemRow
						date="Today"
						icon={null}
						tone="transfer"
						title="Record"
						amount="$0"
						actionLabel="View record"
						onSelect={onSelect}
						selectDisabled
					/>
				</TableBody>
			</Table>,
		);
		const button = screen.getByRole("button", {
			name: "View record",
		}) as HTMLButtonElement;
		expect(button.disabled).toBe(true);
		fireEvent.click(button);
		expect(onSelect).not.toHaveBeenCalled();
	});
});
