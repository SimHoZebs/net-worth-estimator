// @vitest-environment jsdom

import {
	cleanup,
	fireEvent,
	render,
	screen,
	within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account, ProjectionAccountSummary } from "@/lib/projection";
import { createBaseDocument, makeAccount } from "@/lib/projection/__fixtures__";
import { makePosting } from "@/lib/projection/__fixtures__/postings";
import { NO_CEILING, NO_FLOOR } from "@/lib/projection/constants";
import { AccountsTable } from "./AccountsTable";

afterEach(cleanup);

function summaries(accounts: Account[]): ProjectionAccountSummary[] {
	return accounts.map((account, index) => ({
		accountId: account.id,
		label: account.label,
		color: account.color,
		enabled: true,
		startingBalance: index * 100,
		endingBalance: index * 100,
	}));
}

function renderEditableTable() {
	const account = makeAccount({
		id: "checking",
		minBalance: 100,
		maxBalance: 1_000,
	});
	const document = createBaseDocument({ accounts: [account] });
	const updateAccount = vi.fn();
	render(
		<AccountsTable
			editable
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

describe("AccountsTable", () => {
	it("keeps partial limits local and restores them with Escape", () => {
		const updateAccount = renderEditableTable();
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
		const updateAccount = renderEditableTable();
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
			<AccountsTable
				editable
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

	it("keeps invalid numeric drafts visible with an announced error", () => {
		const updateAccount = renderEditableTable();
		const minimum = screen.getByLabelText(
			"Minimum balance for checking",
		) as HTMLInputElement;

		fireEvent.change(minimum, { target: { value: "0x10" } });
		fireEvent.blur(minimum);

		// Invalid drafts stay visible (never silently reverted) with
		// aria-invalid + an announced error until corrected.
		expect(minimum.value).toBe("0x10");
		expect(minimum.getAttribute("aria-invalid")).toBe("true");
		expect(
			screen.getByText(/Minimum balance for checking.*not a number/),
		).not.toBeNull();
		expect(updateAccount).not.toHaveBeenCalled();
	});

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
			<AccountsTable
				accounts={accounts}
				accountRules={[rule]}
				accountSummaries={summaries(accounts)}
				currentNetWorth={100}
				projectionStartDate="2026-01-31"
				balancesAreStale={false}
				showAdvanced={false}
			/>,
		);

		const expanders = [
			screen.getByRole("button", { name: "1 rule for Source account" }),
			screen.getByRole("button", { name: "1 rule for Destination account" }),
		];
		fireEvent.click(expanders[0]);
		fireEvent.click(expanders[1]);
		expect(screen.getAllByText("Transfer rule")).toHaveLength(2);
		const expandedRegion = document.getElementById(
			expanders[0].getAttribute("aria-controls") ?? "",
		);
		expect(expandedRegion).not.toBeNull();
		expect(
			within(expandedRegion as HTMLElement).queryByRole("table"),
		).toBeNull();
	});

	it("keeps rules without an associated account visible", () => {
		const account = makeAccount({ id: "cash" });
		render(
			<AccountsTable
				accounts={[account]}
				accountRules={[
					makePosting({ id: "unassigned", label: "Unassigned rule" }),
				]}
				accountSummaries={summaries([account])}
				currentNetWorth={0}
				projectionStartDate="2026-01-31"
				balancesAreStale={false}
				showAdvanced={false}
			/>,
		);
		expect(screen.getByText("Other rules")).not.toBeNull();
		expect(screen.getByText("Unassigned rule")).not.toBeNull();
	});

	it("shows balances grouped into assets and liabilities", () => {
		const accounts = [
			makeAccount({ id: "cash", label: "Cash" }),
			makeAccount({ id: "loan", label: "Loan" }),
		];
		render(
			<AccountsTable
				accounts={accounts}
				accountRules={[]}
				accountSummaries={[
					{
						accountId: "cash",
						label: "Cash",
						color: null,
						enabled: true,
						startingBalance: 12500,
						endingBalance: 13000,
					},
					{
						accountId: "loan",
						label: "Loan",
						color: null,
						enabled: true,
						startingBalance: -4200,
						endingBalance: -3000,
					},
				]}
				currentNetWorth={8300}
				projectionStartDate="2026-01-31"
				balancesAreStale={false}
				showAdvanced={false}
			/>,
		);

		const summary = screen.getByText("Your accounts").closest("section");
		expect(summary).not.toBeNull();
		expect(within(summary as HTMLElement).getByText("$8,300")).not.toBeNull();
		expect(within(summary as HTMLElement).getByText("$12,500")).not.toBeNull();
		expect(within(summary as HTMLElement).getByText("-$4,200")).not.toBeNull();
		expect(screen.getByText("Jan 31, 2026")).not.toBeNull();
		expect(screen.getByText("Cash")).not.toBeNull();
		expect(screen.getByText("Loan")).not.toBeNull();
	});

	it("does not expose color or enabled columns", () => {
		const account = makeAccount({
			id: "cash",
			label: "Cash",
			color: "#ff0000",
		});
		render(
			<AccountsTable
				accounts={[account]}
				accountRules={[]}
				accountSummaries={summaries([account])}
				currentNetWorth={0}
				projectionStartDate="2026-01-31"
				balancesAreStale={false}
				showAdvanced={false}
			/>,
		);

		expect(
			screen.getAllByRole("columnheader", { name: "Balance" }),
		).toHaveLength(2);
		expect(screen.queryByRole("columnheader", { name: /Color/ })).toBeNull();
		expect(
			screen.queryByRole("columnheader", { name: /Enabled|Status/ }),
		).toBeNull();
		expect(screen.queryByRole("checkbox")).toBeNull();
	});

	it("does not present stale balances", () => {
		const account = makeAccount({ id: "cash", label: "Cash" });
		render(
			<AccountsTable
				accounts={[account]}
				accountRules={[]}
				accountSummaries={[
					{
						accountId: "cash",
						label: "Cash",
						color: null,
						enabled: true,
						startingBalance: 12500,
						endingBalance: 13000,
					},
				]}
				currentNetWorth={12500}
				projectionStartDate="2026-01-31"
				balancesAreStale
				showAdvanced={false}
			/>,
		);

		expect(screen.getByText("Updating balances")).not.toBeNull();
		expect(screen.queryByText("$12,500")).toBeNull();
		expect(screen.getByText("Cash")).not.toBeNull();
	});
});
