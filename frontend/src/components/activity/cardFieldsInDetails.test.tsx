import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "../../domain/model.ts";
import { AccountDetails } from "./AccountDetails.tsx";
import type { AccountEdit } from "./useAccountEdit.ts";

function account(overrides: Partial<Account> = {}): Account {
	return {
		id: "card-a",
		name: "Card A",
		kind: "debt",
		enabled: true,
		archived: false,
		balance: -18000,
		minBalance: 0,
		maxBalance: null,
		color: null,
		observedOn: "2026-01-31",
		balanceCheck: true,
		source: "Manual entry",
		readOnly: false,
		observedAt: 1773133200,
		observedBalance: -18000,
		availableBalance: null,
		displayBasis: "available",
		...overrides,
	};
}

function editStub(kind: "debt" | "cash" = "debt"): AccountEdit {
	return {
		draft: {
			name: "Card A",
			kind,
			enabled: true,
			displayBasis: "available",
			minBalance: "0",
			maxBalance: "",
			noCeiling: true,
			minimumFixed: "25",
			minimumPercent: "2",
			dueDay: "10",
			statementClosingDay: "19",
		},
		formId: "details-form",
		activeField: null,
		update: vi.fn(),
		submit: vi.fn(),
		reset: vi.fn(),
		error: null,
		saving: false,
		dirty: false,
		confirmCancel: false,
		setConfirmCancel: vi.fn(),
		observedAt: null,
		setObservedAt: vi.fn(),
		previousBalance: undefined,
		previous: {} as AccountEdit["previous"],
		saveBlocked: false,
	} as unknown as AccountEdit;
}

describe("card fields in account details", () => {
	it("renders each card field as a peer row in the settings list", () => {
		const { container } = render(
			<AccountDetails account={account()} edit={editStub()} readOnly={false} />,
		);
		const list = container.querySelector('[data-slot="item-group"]');
		const labels = Array.from(list?.querySelectorAll('[data-slot="item"]') ?? []).map(
			(row) => row.textContent,
		);
		for (const label of [
			"Minimum",
			"Minimum percent",
			"Due day",
			"Closing day",
		]) {
			expect(labels.some((text) => text?.includes(label))).toBe(true);
		}
		const closing = screen.getByLabelText(
			/Statement closing day of the month/i,
		) as HTMLInputElement;
		expect(closing.value).toBe("19");
		expect(closing.min).toBe("1");
		expect(closing.max).toBe("31");
		expect(
			screen.queryByRole("heading", { name: "Payment terms" }),
		).toBeNull();
		expect(screen.queryByRole("button", { name: /payment terms/i })).toBeNull();
		expect(container.querySelector("form")).toBeNull();
	});

	it("keeps card fields read-only in a locked view", () => {
		render(
			<AccountDetails account={account({ readOnly: true })} edit={editStub()} readOnly />,
		);
		for (const label of [
			"Minimum payment in USD",
			"Minimum percent of the balance",
			"Due day of the month",
			/Statement closing day of the month/i,
		]) {
			expect((screen.getByLabelText(label) as HTMLInputElement).readOnly).toBe(
				true,
			);
		}
	});

	it("omits card fields for non-debt accounts", () => {
		render(
			<AccountDetails
				account={account({ kind: "cash", id: "checking" })}
				edit={editStub("cash")}
				readOnly={false}
			/>,
		);
		expect(screen.queryByLabelText("Due day of the month")).toBeNull();
		expect(
			screen.queryByLabelText(/Statement closing day of the month/i),
		).toBeNull();
	});

	it("keeps closing day editable for a tracked card sync labelled cash", () => {
		render(
			<AccountDetails
				account={account({ kind: "cash", id: "synced-card" })}
				edit={editStub("cash")}
				readOnly={false}
				cardAccountIds={["synced-card"]}
			/>,
		);
		const closing = screen.getByLabelText(
			/Statement closing day of the month/i,
		) as HTMLInputElement;
		expect(closing.value).toBe("19");
		expect(closing.readOnly).toBe(false);
		expect(screen.queryByLabelText("Due day of the month")).toBeNull();
		expect(screen.queryByLabelText("Minimum payment in USD")).toBeNull();
	});

	it("keeps a tracked card's closing day editable on a synced account", () => {
		render(
			<AccountDetails
				account={account({ kind: "cash", id: "synced-card", readOnly: true })}
				edit={editStub("cash")}
				readOnly
				cardAccountIds={["synced-card"]}
			/>,
		);
		const closing = screen.getByLabelText(
			/Statement closing day of the month/i,
		) as HTMLInputElement;
		expect(closing.readOnly).toBe(false);
	});
});
