import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Account } from "../../domain/model.ts";
import { AccountDetails } from "./AccountDetails.tsx";
import type { AccountEdit } from "./useAccountEdit.ts";

function account(kind: Account["kind"]): Account {
	return {
		id: "card",
		name: "Card",
		kind,
		enabled: true,
		archived: false,
		balance: -500,
		minBalance: 0,
		maxBalance: 1000,
		color: null,
		observedOn: "2026-01-31",
		balanceCheck: true,
		source: "Manual entry",
		readOnly: false,
		displayBasis: "available",
	};
}

function edit(kind: Account["kind"]): AccountEdit {
	return {
		draft: {
			name: "Card",
			kind,
			enabled: true,
			displayBasis: "available",
			minBalance: "0",
			maxBalance: "1000",
			noCeiling: false,
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
		balanceAtTime: undefined,
		balanceAtTimeQuery: {} as AccountEdit["balanceAtTimeQuery"],
		saveBlocked: false,
	} as unknown as AccountEdit;
}

describe("card term fields by account kind", () => {
	it("shows minimum and due day for a credit card", () => {
		render(
			<AccountDetails
				account={account("credit_card")}
				edit={edit("credit_card")}
				readOnly={false}
			/>,
		);
		expect(screen.getByLabelText("Minimum payment in USD")).toBeDefined();
		expect(
			screen.getByLabelText("Minimum percent of the balance"),
		).toBeDefined();
		expect(screen.getByLabelText("Due day of the month")).toBeDefined();
	});

	it("still shows minimum and due day for debt", () => {
		render(
			<AccountDetails
				account={account("debt")}
				edit={edit("debt")}
				readOnly={false}
			/>,
		);
		expect(screen.getByLabelText("Minimum payment in USD")).toBeDefined();
	});

	it("omits minimum and due day for cash", () => {
		render(
			<AccountDetails
				account={account("cash")}
				edit={edit("cash")}
				readOnly={false}
			/>,
		);
		expect(screen.queryByLabelText("Minimum payment in USD")).toBeNull();
		expect(screen.queryByLabelText("Due day of the month")).toBeNull();
	});
});
