import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AccountBalanceValue } from "./AccountBalanceValue.tsx";
import type { AccountEdit } from "./useAccountEdit.ts";

function editStub({
	loading = false,
	failed = false,
}: {
	loading?: boolean;
	failed?: boolean;
} = {}) {
	const refetch = vi.fn();
	const edit = {
		draft: {
			name: "Cash",
			balance: "125",
			kind: "cash",
			enabled: true,
			displayBasis: "available",
			minBalance: "0",
			maxBalance: "",
			noCeiling: true,
			minimumFixed: "",
			minimumPercent: "",
			dueDay: "",
			statementClosingDay: "19",
		},
		formId: "balance-form",
		observedAt: "2026-11-25T12:34:56",
		setObservedAt: vi.fn(),
		update: vi.fn(),
		saving: false,
		balanceAtTime: 100,
		balanceAtTimeQuery: {
			isFetching: loading,
			isPending: false,
			isError: failed,
			refetch,
		},
	} as unknown as AccountEdit;
	return { edit, refetch };
}

describe("balance time editing", () => {
	it("associates the visible label and persistent balance-time help", () => {
		const { edit } = editStub();
		const { container } = render(
			<AccountBalanceValue edit={edit} readOnly={false} />,
		);
		const input = screen.getByLabelText("Balance time (UTC)");
		const helpId = "balance-form-time-help";
		expect(input.getAttribute("aria-describedby")).toBe(helpId);
		expect(document.getElementById(helpId)?.textContent).toBe(
			"Transactions after this time update this balance.",
		);
		expect(input.hasAttribute("aria-invalid")).toBe(false);
		expect(container.textContent).not.toMatch(
			/adjustment|previous balance|balance history/i,
		);
	});

	it("exposes loading through aria-busy and linked text without a live region", () => {
		const { edit } = editStub({ loading: true });
		render(<AccountBalanceValue edit={edit} readOnly={false} />);
		const input = screen.getByLabelText("Balance time (UTC)");
		const loading = screen.getByText("Loading balance at this time…");
		expect(input.getAttribute("aria-busy")).toBe("true");
		expect(input.getAttribute("aria-describedby")).toContain(loading.id);
		expect(loading.hasAttribute("role")).toBe(false);
		expect(loading.hasAttribute("aria-live")).toBe(false);
		expect(input.hasAttribute("aria-invalid")).toBe(false);
	});

	it("marks only a failed check invalid and keeps its error and retry accessible", () => {
		const { edit, refetch } = editStub({ failed: true });
		render(<AccountBalanceValue edit={edit} readOnly={false} />);
		const input = screen.getByLabelText("Balance time (UTC)");
		const error = screen.getByRole("alert");
		const message = screen.getByText(
			"The balance at this time could not be loaded.",
		);
		expect(input.getAttribute("aria-invalid")).toBe("true");
		expect(input.getAttribute("aria-describedby")).toContain(message.id);
		expect(error.textContent).toContain(message.textContent);
		fireEvent.click(screen.getByRole("button", { name: "Retry balance" }));
		expect(refetch).toHaveBeenCalledOnce();
	});
});
