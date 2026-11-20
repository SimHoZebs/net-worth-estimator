import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { StatementPaymentSuggestion as Match } from "@/domain/statementPayment.ts";
import { StatementPaymentSuggestion } from "./StatementPaymentSuggestion.tsx";

function match(overrides: Partial<Match> = {}): Match {
	return {
		key: "oct-2026",
		statementId: "stmt-oct",
		statementLabel: "October 2026 statement",
		statementClose: "2026-10-19",
		dueDate: "2026-11-10",
		statementBalance: 1000,
		remainingBalance: 275.55,
		appliedAmount: 724.45,
		status: "partially-paid",
		paymentAmount: 275.55,
		evidence: "Both sides of this card payment are observed.",
		matcherDetail: "Same cents and counterparty on both legs.",
		alternatives: [],
		actions: {
			apply: true,
			applyPartial: true,
			dismiss: true,
			undo: false,
		},
		...overrides,
	};
}

describe("statement payment suggestion", () => {
	it("shows evidence, amounts, and status without applying anything", () => {
		const onApply = vi.fn().mockResolvedValue(true);
		render(
			<StatementPaymentSuggestion
				suggestion={match()}
				position={1}
				total={1}
				readOnly={false}
				error={null}
				onApply={onApply}
			/>,
		);
		expect(screen.getByText(/both sides of this card payment/i)).toBeTruthy();
		expect(screen.getByText("$1,000.00")).toBeTruthy();
		expect(screen.getByText("$724.45")).toBeTruthy();
		expect(screen.getByText("Partially paid")).toBeTruthy();
		expect(screen.getByText(/a suggestion never applies/i)).toBeTruthy();
		expect(onApply).not.toHaveBeenCalled();
	});

	it("applies the full amount only on an explicit action", async () => {
		const onApply = vi.fn().mockResolvedValue(true);
		render(
			<StatementPaymentSuggestion
				suggestion={match()}
				position={1}
				total={1}
				readOnly={false}
				error={null}
				onApply={onApply}
			/>,
		);
		fireEvent.click(
			screen.getByRole("button", {
				name: "Apply $275.55 to October 2026 statement",
			}),
		);
		await waitFor(() =>
			expect(onApply).toHaveBeenCalledWith("stmt-oct", 275.55),
		);
	});

	it("validates a partial amount before applying it", async () => {
		const onApply = vi.fn().mockResolvedValue(true);
		const onError = vi.fn();
		render(
			<StatementPaymentSuggestion
				suggestion={match()}
				position={1}
				total={1}
				readOnly={false}
				error={null}
				onApply={onApply}
				onError={onError}
			/>,
		);
		const input = screen.getByLabelText("Amount to apply") as HTMLInputElement;
		expect(input.max).toBe("275.55");
		fireEvent.change(input, { target: { value: "0" } });
		fireEvent.click(screen.getByRole("button", { name: /^Apply \$/ }));
		expect(onApply).not.toHaveBeenCalled();
		expect(await screen.findByText(/greater than zero/i)).toBeTruthy();
		expect(input.getAttribute("aria-invalid")).toBe("true");

		fireEvent.change(input, { target: { value: "100.25" } });
		fireEvent.click(screen.getByRole("button", { name: /^Apply \$/ }));
		await waitFor(() =>
			expect(onApply).toHaveBeenCalledWith("stmt-oct", 100.25),
		);
	});

	it("offers dismiss and undo only as permitted", async () => {
		const onDismiss = vi.fn().mockResolvedValue(true);
		const onUndo = vi.fn().mockResolvedValue(true);
		const { rerender } = render(
			<StatementPaymentSuggestion
				suggestion={match()}
				position={1}
				total={1}
				readOnly={false}
				error={null}
				onApply={vi.fn()}
				onDismiss={onDismiss}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Not now" }));
		await waitFor(() => expect(onDismiss).toHaveBeenCalled());
		expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();

		rerender(
			<StatementPaymentSuggestion
				suggestion={match({
					status: "paid-in-full",
					remainingBalance: 0,
					actions: {
						apply: true,
						applyPartial: true,
						dismiss: true,
						undo: true,
					},
				})}
				position={1}
				total={1}
				readOnly={false}
				error={null}
				onApply={vi.fn()}
				onUndo={onUndo}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "Undo" }));
		await waitFor(() => expect(onUndo).toHaveBeenCalled());
		expect(screen.queryByText("Paid in full")).toBeTruthy();
		expect(screen.queryByRole("button", { name: /^Apply \$/ })).toBeNull();
	});

	it("offers another statement only when alternatives exist", () => {
		const { rerender } = render(
			<StatementPaymentSuggestion
				suggestion={match()}
				position={1}
				total={1}
				readOnly={false}
				error={null}
				onApply={vi.fn()}
				onChooseStatement={vi.fn()}
			/>,
		);
		expect(screen.queryByLabelText("Apply to statement")).toBeNull();

		rerender(
			<StatementPaymentSuggestion
				suggestion={match({
					alternatives: [
						{
							statementId: "stmt-nov",
							label: "November 2026 statement",
							statementClose: "2026-11-19",
							remainingBalance: 410,
						},
					],
				})}
				position={1}
				total={1}
				readOnly={false}
				error={null}
				onApply={vi.fn()}
				onChooseStatement={vi.fn()}
			/>,
		);
		expect(screen.getByLabelText("Apply to statement")).toBeTruthy();
	});
});
