// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemporaryAccountForm } from "./TemporaryAccountForm";

afterEach(cleanup);

describe("TemporaryAccountForm", () => {
	it("rejects an account ID already used by the baseline", () => {
		const onAdd = vi.fn();
		render(
			<TemporaryAccountForm
				accounts={[]}
				reservedIds={["checking"]}
				onAdd={onAdd}
				onRemove={() => {}}
			/>,
		);

		fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
		fireEvent.change(screen.getByLabelText("ID"), {
			target: { value: "checking" },
		});
		fireEvent.change(screen.getByLabelText("Label"), {
			target: { value: "Trial checking" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Add account" }));

		expect(onAdd).not.toHaveBeenCalled();
		expect(
			screen.getByText('Account ID "checking" is already in use.'),
		).not.toBeNull();
	});
});
