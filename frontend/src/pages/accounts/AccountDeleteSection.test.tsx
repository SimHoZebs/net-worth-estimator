// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "../../domain/model.ts";
import { AccountDeleteSection } from "./AccountDeleteSection.tsx";

const { deleteSavedAccount } = vi.hoisted(() => ({
	deleteSavedAccount: vi.fn(),
}));

vi.mock("../../state/accountWrites.ts", () => ({ deleteSavedAccount }));

function account(overrides: Partial<Account> = {}): Account {
	return {
		id: "cash",
		name: "Cash",
		kind: "cash",
		enabled: true,
		archived: false,
		balance: 100,
		minBalance: 0,
		maxBalance: null,
		color: null,
		observedOn: "2026-01-31",
		balanceCheck: true,
		source: "Balance check",
		readOnly: false,
		syncOwned: false,
		displayBasis: "available",
		...overrides,
	};
}

function renderSection(
	overrides: Partial<Parameters<typeof AccountDeleteSection>[0]> = {},
) {
	const onDeleted = vi.fn();
	render(
		<AccountDeleteSection
			account={account()}
			readOnly={false}
			busy={false}
			dirty={false}
			onDeleted={onDeleted}
			{...overrides}
		/>,
	);
	return { onDeleted };
}

beforeEach(() => {
	deleteSavedAccount.mockReset();
});

describe("account deletion", () => {
	it("opens a cascade confirmation and cancels without deleting", async () => {
		const user = userEvent.setup();
		const { onDeleted } = renderSection();
		await user.click(screen.getByRole("button", { name: "Delete account" }));
		const dialog = await screen.findByRole("alertdialog", {
			name: "Delete Cash?",
		});
		expect(dialog.textContent).toContain(
			"This permanently deletes the account, its balance history",
		);
		expect(dialog.textContent).toContain("This cannot be undone.");
		await user.click(screen.getByRole("button", { name: "Keep account" }));
		expect(deleteSavedAccount).not.toHaveBeenCalled();
		expect(onDeleted).not.toHaveBeenCalled();
	});

	it("deletes once and completes after the server accepts", async () => {
		const user = userEvent.setup();
		deleteSavedAccount.mockResolvedValue({ persisted: true, refreshed: true });
		const { onDeleted } = renderSection();
		await user.click(screen.getByRole("button", { name: "Delete account" }));
		await user.click(screen.getByRole("button", { name: "Delete account" }));
		await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
		expect(deleteSavedAccount).toHaveBeenCalledTimes(1);
		expect(deleteSavedAccount).toHaveBeenCalledWith(
			"cash",
			expect.any(Function),
		);
	});

	it("keeps synced accounts unavailable with an accessible reason", async () => {
		const user = userEvent.setup();
		renderSection({ account: account({ syncOwned: true, readOnly: true }) });
		const button = screen.getByRole("button", { name: "Delete account" });
		expect(button.getAttribute("aria-disabled")).toBe("true");
		const description = document.getElementById(
			button.getAttribute("aria-describedby") ?? "",
		);
		expect(description?.textContent).toBe("Synced accounts cannot be deleted.");
		await user.click(button);
		expect(screen.queryByRole("alertdialog")).toBeNull();
		expect(deleteSavedAccount).not.toHaveBeenCalled();
	});

	it("keeps manual accounts unavailable in a read-only workspace", async () => {
		const user = userEvent.setup();
		renderSection({ readOnly: true });
		const button = screen.getByRole("button", { name: "Delete account" });
		const description = document.getElementById(
			button.getAttribute("aria-describedby") ?? "",
		);
		expect(description?.textContent).toBe(
			"This workspace is read-only, so accounts cannot be deleted.",
		);
		await user.click(button);
		expect(deleteSavedAccount).not.toHaveBeenCalled();
	});

	it("includes unsaved changes in the confirmation", async () => {
		const user = userEvent.setup();
		renderSection({ dirty: true });
		await user.click(screen.getByRole("button", { name: "Delete account" }));
		const dialog = await screen.findByRole("alertdialog");
		expect(dialog.textContent).toContain(
			"Unsaved changes to this account are also discarded.",
		);
	});

	it("uses whole-loan copy for a grouped manual loan", async () => {
		const user = userEvent.setup();
		renderSection({
			account: account({
				id: "principal",
				name: "Student loan",
				kind: "debt",
				display: {
					name: "Student loan",
					components: [
						{ accountId: "principal", role: "principal" },
						{ accountId: "interest", role: "interest" },
					],
					interestScheduleId: "charge",
					paymentScheduleId: "pay",
				},
			}),
		});
		await user.click(screen.getByRole("button", { name: "Delete loan" }));
		const dialog = await screen.findByRole("alertdialog", {
			name: "Delete Student loan?",
		});
		expect(dialog.textContent).toContain("both accounts in the loan");
		expect(dialog.textContent).toContain(
			"managed interest and payment schedules",
		);
		expect(dialog.textContent).toContain("planned purchase");
		expect(screen.getByRole("button", { name: "Keep loan" })).not.toBeNull();
	});

	it("keeps a rejected deletion open with the server message", async () => {
		const user = userEvent.setup();
		deleteSavedAccount.mockImplementation(
			async (_id: string, reject: (message: string) => void) => {
				reject("The account is still syncing.");
				return { persisted: false, refreshed: false };
			},
		);
		renderSection();
		await user.click(screen.getByRole("button", { name: "Delete account" }));
		await user.click(screen.getByRole("button", { name: "Delete account" }));
		expect(
			await screen.findByText("The account is still syncing."),
		).not.toBeNull();
		expect(screen.getByRole("alertdialog")).not.toBeNull();
	});

	it("navigates after persistence even when the authoritative reload fails", async () => {
		const user = userEvent.setup();
		deleteSavedAccount.mockResolvedValue({ persisted: true, refreshed: false });
		const { onDeleted } = renderSection();
		await user.click(screen.getByRole("button", { name: "Delete account" }));
		await user.click(screen.getByRole("button", { name: "Delete account" }));
		await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
		expect(deleteSavedAccount).toHaveBeenCalledTimes(1);
	});

	it("blocks dismissal and repeated submission while deleting", async () => {
		const user = userEvent.setup();
		let finish!: (value: { persisted: boolean; refreshed: boolean }) => void;
		deleteSavedAccount.mockReturnValue(
			new Promise((resolve) => {
				finish = resolve;
			}),
		);
		const { onDeleted } = renderSection();
		await user.click(screen.getByRole("button", { name: "Delete account" }));
		await user.click(screen.getByRole("button", { name: "Delete account" }));
		expect(
			(screen.getByRole("button", { name: "Deleting…" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			(
				screen.getByRole("button", {
					name: "Keep account",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		await user.keyboard("{Escape}");
		expect(screen.getByRole("alertdialog")).not.toBeNull();
		expect(deleteSavedAccount).toHaveBeenCalledTimes(1);
		finish({ persisted: true, refreshed: true });
		await waitFor(() => expect(onDeleted).toHaveBeenCalledTimes(1));
	});
});
