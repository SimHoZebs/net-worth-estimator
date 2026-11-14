import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import {
	accountTransactions,
	defaultAccountViewFilters,
} from "../../domain/accountActivity.ts";
import { Transactions } from "./Transactions.tsx";

vi.mock("../analysis/TransactionAnalysis.tsx", async (importOriginal) => ({
	...(await importOriginal<
		typeof import("../analysis/TransactionAnalysis.tsx")
	>()),
	TransactionAnalysisProvider: ({ children }: { children: ReactNode }) => (
		<>{children}</>
	),
}));

const { accounts, transactions, startDate } = financialModelFixture;

function recordedProps() {
	const occurrences = accountTransactions({
		accountId: "checking",
		accounts,
		transactions,
		startDate,
		projection: null,
	});
	expect(occurrences).toHaveLength(3);
	return {
		occurrences,
		rows: transactions,
		accounts,
		startDate,
		readOnly: false as const,
		onEdit: () => {},
	};
}

async function chooseSource(value: "all" | "historical" | "projected") {
	const user = userEvent.setup();
	await user.click(
		screen.getByRole("combobox", { name: "Transaction source" }),
	);
	const name =
		value === "all"
			? "All transactions"
			: value === "historical"
				? /Historical/
				: /Projected/;
	await user.click(await screen.findByRole("option", { name }));
}

describe("finance-first transaction activity", () => {
	it("renders recorded history without any forecast state", () => {
		render(<Transactions {...recordedProps()} />);
		expect(
			screen.getAllByRole("button", { name: /View Household payroll/ }),
		).toHaveLength(3);
		expect(screen.queryByRole("button", { name: "Retry forecast" })).toBeNull();
		expect(screen.queryByText("Loading projected activity…")).toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("shows loading only for projected activity", async () => {
		render(
			<Transactions
				{...recordedProps()}
				projected={{
					loading: true,
					error: null,
					requested: true,
					retry: () => {},
				}}
			/>,
		);
		expect(screen.queryByText("Loading projected activity…")).toBeNull();
		await chooseSource("projected");
		expect(screen.getByText("Loading projected activity…").textContent).toBe(
			"Loading projected activity…",
		);
	});

	it("recovers projected activity with retry without blocking recorded history", async () => {
		const retry = vi.fn();
		render(
			<Transactions
				{...recordedProps()}
				projected={{
					loading: false,
					error: "Forecast unavailable for test",
					requested: true,
					retry,
				}}
			/>,
		);
		// Recorded history stays usable while the forecast fails.
		expect(
			screen.getAllByRole("button", { name: /View Household payroll/ }),
		).toHaveLength(3);
		await chooseSource("projected");
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("Forecast unavailable for test");
		const retryUser = userEvent.setup();
		await retryUser.click(screen.getByRole("button", { name: "Retry forecast" }));
		expect(retry).toHaveBeenCalledTimes(1);
		// Switching back restores recorded rows and clears recovery UI.
		await chooseSource("historical");
		expect(
			screen.getAllByRole("button", { name: /View Household payroll/ }),
		).toHaveLength(3);
		expect(screen.queryByRole("button", { name: "Retry forecast" })).toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("notifies when the viewer asks for projected activity", async () => {
		const onSourceChange = vi.fn();
		render(
			<Transactions {...recordedProps()} onSourceChange={onSourceChange} />,
		);
		await chooseSource("all");
		expect(onSourceChange).toHaveBeenCalledWith("all");
		expect(defaultAccountViewFilters.source).toBe("historical");

		// Saved rules can project without recorded facts, so the select
		// stays available for the empty-but-projectable account.
		onSourceChange.mockClear();
		cleanup();
		const empty = recordedProps();
		render(
			<Transactions
				{...empty}
				occurrences={[]}
				canRequestForecast
				onSourceChange={onSourceChange}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Add transaction" }),
		).toBeTruthy();
		await chooseSource("projected");
		expect(onSourceChange).toHaveBeenCalledWith("projected");
	});

	it("keeps the add-only empty state for truly inactive accounts", () => {
		const props = recordedProps();
		render(<Transactions {...props} occurrences={[]} />);
		expect(
			screen.getByRole("button", { name: "Add transaction" }),
		).toBeTruthy();
		expect(screen.queryByLabelText("Transaction source")).toBeNull();
		expect(screen.queryByRole("searchbox")).toBeNull();
	});
});
