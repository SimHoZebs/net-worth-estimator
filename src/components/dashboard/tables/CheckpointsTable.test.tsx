// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeAccount } from "@/lib/projection/__fixtures__/accounts";
import { createBaseDocument } from "@/lib/projection/__fixtures__/documents";
import { CheckpointsTable } from "./CheckpointsTable";

afterEach(cleanup);

describe("CheckpointsTable", () => {
	it("edits checkpoint rows and adds new ones", () => {
		const document = createBaseDocument({
			accounts: [makeAccount({ id: "checking", label: "Checking" })],
			checkpoints: [
				{ Date: "2026-01-31", AccountId: "checking", Balance: 12500 },
			],
		});
		const updateCheckpoint = vi.fn();
		const addCheckpoint = vi.fn();
		render(
			<CheckpointsTable
				editable
				displayDocument={document}
				projectionStartDate="2026-01-31"
				updateCheckpoint={updateCheckpoint}
				deleteCheckpoint={vi.fn()}
				addCheckpoint={addCheckpoint}
			/>,
		);

		const dateInput = screen.getByDisplayValue(
			"2026-01-31",
		) as HTMLInputElement;
		fireEvent.change(dateInput, { target: { value: "2026-02-01" } });
		expect(updateCheckpoint).toHaveBeenCalledWith(0, { Date: "2026-02-01" });

		fireEvent.click(screen.getByText("Add checkpoint"));
		expect(addCheckpoint).toHaveBeenCalledWith({
			Date: "2026-01-31",
			AccountId: "checking",
			Balance: 0,
		});
	});

	it("lists observed balances with account labels", () => {
		render(
			<CheckpointsTable
				checkpoints={[
					{ Date: "2026-01-31", AccountId: "checking", Balance: 12500 },
				]}
				showAdvanced={false}
				accountLabelById={new Map([["checking", "Checking"]])}
			/>,
		);

		expect(screen.getByText("Balance checkpoints")).not.toBeNull();
		expect(screen.getByText("Jan 31, 2026")).not.toBeNull();
		expect(screen.getByText("Checking")).not.toBeNull();
		expect(screen.getByText("$12,500")).not.toBeNull();
	});

	it("shows account IDs in advanced mode and filters by search", () => {
		const { rerender } = render(
			<CheckpointsTable
				checkpoints={[
					{ Date: "2026-01-31", AccountId: "checking", Balance: 12500 },
				]}
				showAdvanced={false}
				accountLabelById={new Map([["checking", "Checking"]])}
			/>,
		);
		expect(screen.queryByText("checking")).toBeNull();

		rerender(
			<CheckpointsTable
				checkpoints={[
					{ Date: "2026-01-31", AccountId: "checking", Balance: 12500 },
				]}
				showAdvanced
				accountLabelById={new Map([["checking", "Checking"]])}
			/>,
		);
		expect(screen.getByText("checking")).not.toBeNull();

		fireEvent.change(
			screen.getByPlaceholderText("Search balance checkpoints..."),
			{ target: { value: "no-match" } },
		);
		expect(screen.getByText("No balance checkpoints.")).not.toBeNull();
	});
});
