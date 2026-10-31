import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { failureLedger } from "../../domain/constraintSnapshot.ts";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import {
	activityProjection,
	transactionFixture,
} from "../../mocks/projection.ts";
import { ConstraintSnapshot } from "./ConstraintSnapshot.tsx";

// Selection assertions use a marker detail; editors keep browser coverage.
vi.mock("../activity/TransactionDetail.tsx", () => ({
	TransactionDetail: ({
		transaction,
	}: {
		transaction: { name: string; date: string };
	}) => (
		<p data-testid="selected-snapshot-row" data-date={transaction.date}>
			{transaction.name}
		</p>
	),
}));

afterEach(cleanup);

function snapshotProps() {
	const projection = activityProjection();
	const failure = transactionFixture({
		transactionId: "living",
		name: "Everyday living",
		date: "2026-11-01",
		requested: 5400,
		realized: 5400,
		fromId: "checking",
		toId: null,
		constraint: null,
	});
	const ledger = failureLedger({
		accounts: financialModelFixture.accounts,
		transactions: financialModelFixture.transactions,
		startDate: financialModelFixture.startDate,
		projection,
		failure,
	});
	if (!ledger) throw new Error("expected a failure ledger");
	return { projection, failure, ledger };
}

it("keeps the open row across data refreshes and closes it when the saved rule is gone", () => {
	const { failure, ledger } = snapshotProps();
	const base = {
		ledger,
		failure,
		accounts: financialModelFixture.accounts,
		transactions: financialModelFixture.transactions,
		readOnly: financialModelFixture.readOnly,
	};
	const view = render(<ConstraintSnapshot {...base} />);
	fireEvent.click(view.getAllByRole("button", { name: /Everyday living/ })[0]!);
	expect(view.getByTestId("selected-snapshot-row").textContent).toContain(
		"Everyday living",
	);
	const selectedDate = view.getByTestId("selected-snapshot-row").dataset.date;
	// An unrelated refresh arrives with brand-new identities but the same
	// rows: the open detail stays on its row.
	const refresh = activityProjection();
	// An earlier occurrence shifts the index in every projected row id.
	refresh.transactions.unshift(
		transactionFixture({ transactionId: "earlier", date: "2026-09-25" }),
	);
	const refreshed = failureLedger({
		accounts: financialModelFixture.accounts,
		transactions: financialModelFixture.transactions,
		startDate: financialModelFixture.startDate,
		projection: refresh,
		failure,
	});
	if (!refreshed) throw new Error("expected a refreshed ledger");
	view.rerender(
		<ConstraintSnapshot
			{...base}
			ledger={refreshed}
			failure={{ ...failure }}
			accounts={[...financialModelFixture.accounts]}
			transactions={[...financialModelFixture.transactions]}
		/>,
	);
	expect(view.getByTestId("selected-snapshot-row").textContent).toContain(
		"Everyday living",
	);
	expect(view.getByTestId("selected-snapshot-row").dataset.date).toBe(
		selectedDate,
	);
	// The saved rule itself is gone: the refreshed rows carry no saved
	// rule, so the detail closes instead of showing a stale row.
	const withoutRule = failureLedger({
		accounts: financialModelFixture.accounts,
		transactions: financialModelFixture.transactions.filter(
			(saved) => saved.id !== "living",
		),
		startDate: financialModelFixture.startDate,
		projection: refresh,
		failure,
	});
	if (!withoutRule) throw new Error("expected a ledger without the rule");
	view.rerender(
		<ConstraintSnapshot
			{...base}
			ledger={withoutRule}
			transactions={financialModelFixture.transactions.filter(
				(saved) => saved.id !== "living",
			)}
		/>,
	);
	expect(view.queryByTestId("selected-snapshot-row")).toBeNull();
});
