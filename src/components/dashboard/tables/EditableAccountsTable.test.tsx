// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBaseDocument, makeAccount } from "@/lib/projection/__fixtures__";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";
import { EditableAccountsTable } from "./EditableAccountsTable";

afterEach(cleanup);

describe("EditableAccountsTable", () => {
	function renderTable() {
		const account = makeAccount({
			id: "checking",
			minBalance: 100,
			maxBalance: 1_000,
		});
		const document = createBaseDocument({ accounts: [account] });
		const updateAccount = vi.fn();
		render(
			<EditableAccountsTable
				displayDocument={document}
				document={document}
				isDirty={false}
				workingDocument={null}
				updateAccount={updateAccount}
				deleteAccount={vi.fn()}
				addAccount={vi.fn()}
			/>,
		);
		return updateAccount;
	}

	it("keeps partial limits local and restores them with Escape", () => {
		const updateAccount = renderTable();
		const minimum = screen.getByLabelText(
			"Minimum balance for checking",
		) as HTMLInputElement;

		fireEvent.change(minimum, { target: { value: "-" } });
		expect(minimum.value).toBe("-");
		expect(updateAccount).not.toHaveBeenCalled();

		fireEvent.keyDown(minimum, { key: "Escape" });
		expect(minimum.value).toBe("100");
		expect(updateAccount).not.toHaveBeenCalled();
	});

	it("commits finite limits on Enter and sentinel blanks on blur", () => {
		const updateAccount = renderTable();
		const minimum = screen.getByLabelText("Minimum balance for checking");
		const maximum = screen.getByLabelText("Maximum balance for checking");

		fireEvent.change(minimum, { target: { value: "125.5" } });
		fireEvent.keyDown(minimum, { key: "Enter" });
		expect(updateAccount).toHaveBeenCalledWith("checking", {
			minBalance: 125.5,
		});

		fireEvent.change(maximum, { target: { value: "" } });
		fireEvent.blur(maximum);
		expect(updateAccount).toHaveBeenCalledWith("checking", {
			maxBalance: NO_CEILING,
		});
	});

	it("renders unbounded limits as blanks", () => {
		const account = makeAccount({
			id: "checking",
			minBalance: NO_FLOOR,
			maxBalance: NO_CEILING,
		});
		const document = createBaseDocument({ accounts: [account] });
		render(
			<EditableAccountsTable
				displayDocument={document}
				document={document}
				isDirty={false}
				workingDocument={null}
				updateAccount={vi.fn()}
				deleteAccount={vi.fn()}
				addAccount={vi.fn()}
			/>,
		);

		expect(
			(
				screen.getByLabelText(
					"Minimum balance for checking",
				) as HTMLInputElement
			).value,
		).toBe("");
		expect(
			(
				screen.getByLabelText(
					"Maximum balance for checking",
				) as HTMLInputElement
			).value,
		).toBe("");
	});

	it("rejects JavaScript non-decimal numeric syntax", () => {
		const updateAccount = renderTable();
		const minimum = screen.getByLabelText(
			"Minimum balance for checking",
		) as HTMLInputElement;

		fireEvent.change(minimum, { target: { value: "0x10" } });
		fireEvent.blur(minimum);

		expect(minimum.value).toBe("100");
		expect(updateAccount).not.toHaveBeenCalled();
	});
});
