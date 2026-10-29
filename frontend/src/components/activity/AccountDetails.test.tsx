import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "../../domain/model.ts";
import { testAccount } from "../../mocks/account.ts";
import { AccountDetails } from "./AccountDetails.tsx";

afterEach(cleanup);

const home = testAccount.accounts.find((account) => account.id === "home")!;

function input(name: string): HTMLInputElement {
	const element = screen.getByLabelText(name);
	if (!(element instanceof HTMLInputElement))
		throw new Error(`Expected an input labelled "${name}"`);
	return element;
}

describe("AccountDetails", () => {
	it("refreshes untouched fields without creating a local edit", () => {
		const onApply = vi.fn(() => true);
		const props = {
			account: home,
			plan: testAccount,
			endingBalance: 480000,
			onApply,
		};
		const view = render(<AccountDetails {...props} />);
		view.rerender(
			<AccountDetails {...props} account={{ ...home, name: "Current home" }} />,
		);
		expect(input("Account name").value).toBe("Current home");
		expect(
			(
				screen.getByRole("button", {
					name: "Save changes",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("preserves edits across unrelated refreshes and rejects same-field conflicts", () => {
		const onApply = vi.fn(() => true);
		const props = {
			account: home,
			plan: testAccount,
			endingBalance: 480000,
			onApply,
		};
		const view = render(<AccountDetails {...props} />);
		fireEvent.change(input("Account name"), { target: { value: "My home" } });
		view.rerender(
			<AccountDetails
				{...props}
				account={{ ...home, balance: home.balance + 100 }}
			/>,
		);
		expect(input("Account name").value).toBe("My home");
		view.rerender(
			<AccountDetails {...props} account={{ ...home, name: "Another name" }} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(onApply).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Discard edits and use current values",
			}),
		);
		expect(input("Account name").value).toBe("Another name");
	});

	it("edits inline with source display-only and a grouped balance range", () => {
		const applied: { plan: Plan | null } = { plan: null };
		render(
			<AccountDetails
				account={home}
				plan={testAccount}
				endingBalance={480000}
				onApply={(plan) => {
					applied.plan = plan;
					return true;
				}}
			/>,
		);
		// No second modal: there is no edit button, fields are live inputs.
		expect(screen.queryByRole("button", { name: "Edit account" })).toBeNull();
		expect(input("Account name").value).toBe("Home value");
		// Source is provenance text, never an editable field.
		expect(screen.getByText("Source")).toBeTruthy();
		expect(screen.queryByRole("textbox", { name: "Source" })).toBeNull();
		expect(screen.getByText("Example home estimate")).toBeTruthy();
		// Protected and ceiling share one range group with a visual track.
		expect(
			screen.getByRole("group", { name: "Balance limits (USD)" }),
		).toBeTruthy();
		expect(input("Protected balance in USD").value).toBe("0");
		expect(input("Maximum balance in USD").disabled).toBe(true);
		expect(input("No ceiling").checked).toBe(true);
		const apply = screen.getByRole("button", {
			name: "Save changes",
		}) as HTMLButtonElement;
		expect(apply.disabled).toBe(true);
		fireEvent.change(input("Protected balance in USD"), {
			target: { value: "5000" },
		});
		expect(apply.disabled).toBe(false);
		fireEvent.click(apply);
		const updated = applied.plan?.accounts.find(
			(account) => account.id === "home",
		);
		expect(updated?.minBalance).toBe(5000);
		expect(updated?.maxBalance).toBeNull();
		// Source survives the edit untouched.
		expect(updated?.source).toBe("Example home estimate");
	});

	it("unchecking the ceiling enables the maximum input", () => {
		const applied: { plan: Plan | null } = { plan: null };
		render(
			<AccountDetails
				account={home}
				plan={testAccount}
				endingBalance={480000}
				onApply={(plan) => {
					applied.plan = plan;
					return true;
				}}
			/>,
		);
		fireEvent.click(input("No ceiling"));
		const ceiling = input("Maximum balance in USD");
		expect(ceiling.disabled).toBe(false);
		expect(ceiling.value).toBe("0");
		fireEvent.change(ceiling, { target: { value: "100000" } });
		fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
		expect(
			applied.plan?.accounts.find((account) => account.id === "home")
				?.maxBalance,
		).toBe(100000);
	});

	it("locks every field for read-only source records", () => {
		const { container } = render(
			<AccountDetails
				account={{ ...home, readOnly: true }}
				plan={testAccount}
				endingBalance={480000}
				onApply={() => true}
			/>,
		);
		// jsdom does not cascade fieldset[disabled] to the disabled IDL, so
		// assert the attribute on the group itself: real browsers lock all
		// descendants behind it.
		expect(container.querySelector("fieldset[disabled]")).toBeTruthy();
		expect(screen.queryByRole("button", { name: "Save changes" })).toBeNull();
		expect(screen.getByText(/refreshed copy/)).toBeTruthy();
	});
});
