// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { makeAccount } from "@/lib/projection/__fixtures__/accounts";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import { ReadOnlyAccountsTable } from "./ReadOnlyAccountsTable";

afterEach(cleanup);

describe("ReadOnlyAccountsTable", () => {
	it("shows an account rule under every associated account", () => {
		const accounts = [
			makeAccount({ id: "source", label: "Source account" }),
			makeAccount({ id: "destination", label: "Destination account" }),
		];
		const rule = makePosting({
			id: "transfer-rule",
			label: "Transfer rule",
			sourceAccountId: "source",
			destinations: ["destination"],
			arithmetic: "100",
		});
		render(
			<ReadOnlyAccountsTable
				accounts={accounts}
				accountRules={[rule]}
				showAdvanced={false}
				disabledAccountSet={new Set()}
				disabledPostingSet={new Set()}
				onToggleAccount={() => {}}
				onTogglePosting={() => {}}
			/>,
		);

		const expanders = screen.getAllByRole("button", { name: "1 rule" });
		fireEvent.click(expanders[0]);
		fireEvent.click(expanders[1]);
		expect(screen.getAllByText("Transfer rule")).toHaveLength(2);
		expect(
			screen.getByLabelText("Enable Transfer rule for Source account"),
		).not.toBeNull();
		expect(
			screen.getByLabelText("Enable Transfer rule for Destination account"),
		).not.toBeNull();
	});

	it("keeps rules without an associated account visible", () => {
		render(
			<ReadOnlyAccountsTable
				accounts={[makeAccount({ id: "cash" })]}
				accountRules={[
					makePosting({ id: "unassigned", label: "Unassigned rule" }),
				]}
				showAdvanced={false}
				disabledAccountSet={new Set()}
				disabledPostingSet={new Set()}
				onToggleAccount={() => {}}
				onTogglePosting={() => {}}
			/>,
		);
		expect(screen.getByText("Unassigned account rules")).not.toBeNull();
		expect(screen.getByText("Unassigned rule")).not.toBeNull();
	});
});
