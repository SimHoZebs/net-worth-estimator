import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Plan } from "../../domain/model.ts";
import { testPlan } from "../../test/plan.ts";
import { AccountDetails } from "./AccountDetails.tsx";

afterEach(cleanup);

const home = testPlan.accounts.find((account) => account.id === "home")!;

function input(name: string): HTMLInputElement {
	const element = screen.getByLabelText(name);
	if (!(element instanceof HTMLInputElement))
		throw new Error(`Expected an input labelled "${name}"`);
	return element;
}

describe("AccountDetails", () => {
	it("edits inline with source display-only and a grouped balance range", () => {
		const applied: { plan: Plan | null } = { plan: null };
		render(
			<AccountDetails
				account={home}
				plan={testPlan}
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
			name: "Apply unsaved changes",
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
				plan={testPlan}
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
		fireEvent.click(
			screen.getByRole("button", { name: "Apply unsaved changes" }),
		);
		expect(
			applied.plan?.accounts.find((account) => account.id === "home")
				?.maxBalance,
		).toBe(100000);
	});

	it("locks every field for read-only source records", () => {
		const { container } = render(
			<AccountDetails
				account={{ ...home, readOnly: true }}
				plan={testPlan}
				endingBalance={480000}
				onApply={() => true}
			/>,
		);
		// jsdom does not cascade fieldset[disabled] to the disabled IDL, so
		// assert the attribute on the group itself: real browsers lock all
		// descendants behind it.
		expect(container.querySelector("fieldset[disabled]")).toBeTruthy();
		expect(
			screen.queryByRole("button", { name: "Apply unsaved changes" }),
		).toBeNull();
		expect(screen.getByText(/refreshed plan/)).toBeTruthy();
	});
});
