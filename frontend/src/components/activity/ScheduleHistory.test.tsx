import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TransferLink } from "../../api/generated/model/transferLink.ts";
import type { Account, Transaction } from "../../domain/model.ts";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { ScheduleHistory } from "./ScheduleHistory.tsx";

const linkState = vi.hoisted(() => ({
	data: { links: [] as TransferLink[] },
}));

vi.mock("../../state/analyses.ts", () => ({
	useTransferLinks: () => ({ data: linkState.data }),
}));

const accounts: Account[] = [
	financialModelFixture.accounts[0]!,
	financialModelFixture.accounts[1]!,
];

function transaction(
	id: string,
	overrides: Partial<Transaction> = {},
): Transaction {
	return {
		...financialModelFixture.transactions[0]!,
		id,
		name: id,
		kind: "transaction",
		fromId: "checking",
		toId: null,
		startDate: "2026-11-20",
		amount: 12,
		annualIncrease: 0,
		recognizedBusinessKey: "spotify",
		...overrides,
	};
}

beforeEach(() => {
	linkState.data = { links: [] };
});

describe("schedule history transfer display", () => {
	it("resolves a linked peer from all saved transactions at the list boundary", () => {
		const visible = transaction("card-payment");
		const peer = transaction("bank-leg", { fromId: "savings" });
		linkState.data = {
			links: [{ legA: visible.id, legB: peer.id } as TransferLink],
		};
		const { container } = render(
			<ScheduleHistory
				transactions={[visible]}
				allTransactions={[visible, peer]}
				accounts={accounts}
				startDate="2026-11-01"
				onSelect={vi.fn()}
			/>,
		);

		expect(screen.getByText("To Emergency fund")).toBeTruthy();
		expect(
			container.querySelector("svg.lucide-arrow-right-left"),
		).not.toBeNull();
		expect(container.querySelector("[data-transaction-icon] img")).toBeNull();
	});
});
