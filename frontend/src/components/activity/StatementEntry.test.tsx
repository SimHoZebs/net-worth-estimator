import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StatementEntry, type StatementEntryValue } from "./StatementEntry.tsx";

describe("statement entry form", () => {
	it("collects the statement close, balance, and due date", async () => {
		const onSubmit = vi.fn().mockResolvedValue(true);
		render(
			<StatementEntry
				accountLabel="Card A"
				initial={{ statementClose: "2026-10-19" }}
				onSubmit={onSubmit}
			/>,
		);
		expect(
			screen.getByRole("heading", { name: "Add a statement for Card A" }),
		).toBeTruthy();
		fireEvent.change(screen.getByLabelText("Statement balance"), {
			target: { value: "275.55" },
		});
		fireEvent.change(screen.getByLabelText("Due date"), {
			target: { value: "2026-11-10" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Save statement" }));
		await waitFor(() =>
			expect(onSubmit).toHaveBeenCalledWith({
				statementClose: "2026-10-19",
				statementBalance: 275.55,
				dueDate: "2026-11-10",
			} satisfies StatementEntryValue),
		);
	});

	it("blocks an empty balance and reports how to fix it", async () => {
		const onSubmit = vi.fn();
		render(<StatementEntry onSubmit={onSubmit} />);
		fireEvent.click(screen.getByRole("button", { name: "Save statement" }));
		expect(onSubmit).not.toHaveBeenCalled();
		expect(
			await screen.findByText(/enter the statement balance/i),
		).toBeTruthy();
		const balance = screen.getByLabelText("Statement balance");
		expect(balance.getAttribute("aria-invalid")).toBe("true");
	});

	it("explains that an estimate is not the statement balance", () => {
		render(<StatementEntry onSubmit={vi.fn()} />);
		expect(screen.getByText(/is not the statement balance/i)).toBeTruthy();
	});

	it("locks edits and shows the server error when read only", () => {
		render(
			<StatementEntry
				readOnly
				error="The statement could not be saved."
				onSubmit={vi.fn()}
			/>,
		);
		expect(
			(screen.getByLabelText("Statement balance") as HTMLInputElement).disabled,
		).toBe(true);
		expect(
			screen
				.getByRole("button", { name: "Save statement" })
				.hasAttribute("disabled"),
		).toBe(true);
		expect(screen.getByText(/could not be saved/i)).toBeTruthy();
	});
});
