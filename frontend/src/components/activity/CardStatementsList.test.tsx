import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DerivedCardStatement } from "@/domain/derivedStatement.ts";
import { CardStatementsList } from "./CardStatementsList.tsx";

function statement(
	overrides: Partial<DerivedCardStatement> = {},
): DerivedCardStatement {
	return {
		id: "stmt-oct",
		accountId: "card-a",
		closingDate: "2026-10-19",
		billedAmount: 125.55,
		remaining: 125.55,
		allocated: 0,
		dueDate: "2026-11-10",
		status: "open",
		...overrides,
	};
}

describe("derived card statements list", () => {
	it("shows the close, billed amount, remaining, status, and due date when known", () => {
		render(<CardStatementsList statements={[statement()]} state="ready" />);
		expect(screen.getByText("Oct 19, 2026 statement")).toBeTruthy();
		expect(screen.getByText("Due Nov 10, 2026 · $125.55 billed")).toBeTruthy();
		expect(screen.getByText("$125.55 remaining · Open")).toBeTruthy();
	});

	it("states unknown amounts, due date, and status explicitly", () => {
		render(
			<CardStatementsList
				statements={[
					statement({
						billedAmount: null,
						remaining: null,
						allocated: null,
						dueDate: null,
						status: "unknown",
					}),
				]}
				state="ready"
			/>,
		);
		expect(
			screen.getByText("Due date unknown · Billed amount unknown"),
		).toBeTruthy();
		expect(screen.getByText("Remaining unknown · Status unknown")).toBeTruthy();
	});

	it("shows loading, empty, and error states", () => {
		const retry = vi.fn();
		const { rerender } = render(
			<CardStatementsList statements={[]} state="pending" />,
		);
		expect(screen.getByText("Loading statements…")).toBeTruthy();
		rerender(<CardStatementsList statements={[]} state="ready" />);
		expect(screen.getByText("No recorded statements.")).toBeTruthy();
		rerender(
			<CardStatementsList statements={[]} state="error" onRetry={retry} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry" }));
		expect(retry).toHaveBeenCalledOnce();
	});
});
