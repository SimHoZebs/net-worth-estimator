import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

afterEach(cleanup);

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

function sourceSelect(): HTMLSelectElement {
	const select = screen.getByLabelText("Transaction source");
	if (!(select instanceof HTMLSelectElement))
		throw new Error("Expected the activity source select");
	return select;
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

	it("shows loading only for projected activity", () => {
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
		fireEvent.change(sourceSelect(), { target: { value: "projected" } });
		expect(screen.getByText("Loading projected activity…").textContent).toBe(
			"Loading projected activity…",
		);
	});

	it("recovers projected activity with retry without blocking recorded history", () => {
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
		fireEvent.change(sourceSelect(), { target: { value: "projected" } });
		const alert = screen.getByRole("alert");
		expect(alert.textContent).toContain("Forecast unavailable for test");
		fireEvent.click(screen.getByRole("button", { name: "Retry forecast" }));
		expect(retry).toHaveBeenCalledTimes(1);
		// Switching back restores recorded rows and clears recovery UI.
		fireEvent.change(sourceSelect(), { target: { value: "historical" } });
		expect(
			screen.getAllByRole("button", { name: /View Household payroll/ }),
		).toHaveLength(3);
		expect(screen.queryByRole("button", { name: "Retry forecast" })).toBeNull();
		expect(screen.queryByRole("alert")).toBeNull();
	});

	it("notifies when the viewer asks for projected activity", () => {
		const onSourceChange = vi.fn();
		render(
			<Transactions {...recordedProps()} onSourceChange={onSourceChange} />,
		);
		fireEvent.change(sourceSelect(), { target: { value: "all" } });
		expect(onSourceChange).toHaveBeenCalledWith("all");
		expect(defaultAccountViewFilters.source).toBe("historical");
	});

	it("keeps the source select when saved rules can project without recorded facts", () => {
		const onSourceChange = vi.fn();
		const props = recordedProps();
		render(
			<Transactions
				{...props}
				occurrences={[]}
				canRequestForecast
				onSourceChange={onSourceChange}
			/>,
		);
		expect(
			screen.getByRole("button", { name: "Add a planned transaction" }),
		).toBeTruthy();
		fireEvent.change(sourceSelect(), { target: { value: "projected" } });
		expect(onSourceChange).toHaveBeenCalledWith("projected");
	});

	it("keeps the add-only empty state for truly inactive accounts", () => {
		const props = recordedProps();
		render(<Transactions {...props} occurrences={[]} />);
		expect(
			screen.getByRole("button", { name: "Add a planned transaction" }),
		).toBeTruthy();
		expect(screen.queryByLabelText("Transaction source")).toBeNull();
		expect(screen.queryByRole("searchbox")).toBeNull();
	});
});
