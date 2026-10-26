import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AmountBuilder } from "./AmountBuilder.tsx";
import { buildTemplateAmount } from "./AmountBuilder.tsx";
import {
	patchTemplateAmount,
	templateFieldsFromAmount,
} from "./amountDraft.ts";
import type { AmountTemplate } from "../../api/contracts.ts";

afterEach(cleanup);

it("starts from the saved built-in recipe and applies only explicit edits", () => {
	const amount = {
		resolver: "expression",
		config: { expression: "750", custom: "preserve" },
		inputs: {},
	};
	const template = {
		id: "fixed",
		label: "Saved fixed amount",
		summary: "",
		whenToUse: "",
		amount,
	} as AmountTemplate;
	const onChange = vi.fn();
	render(
		<AmountBuilder
			accounts={[]}
			postings={[]}
			templates={[template]}
			onChange={onChange}
		/>,
	);
	const field = screen.getByRole("spinbutton", {
		name: "Dollars each time",
	}) as HTMLInputElement;
	expect(field.value).toBe("750");
	fireEvent.click(screen.getByRole("button", { name: "Use this amount" }));
	expect(onChange).toHaveBeenLastCalledWith(amount);
	fireEvent.change(field, { target: { value: "900" } });
	fireEvent.click(screen.getByRole("button", { name: "Use this amount" }));
	expect(onChange).toHaveBeenLastCalledWith({
		...amount,
		config: { expression: "900", custom: "preserve" },
	});
});

it.each([
	"growth",
	"account-percent",
	"investment-growth",
	"debt-minimum",
	"late-fee",
	"low-balance-fee",
	"federal-tax",
])("round-trips %s without reconstructing untouched fields", (id) => {
	const amount = buildTemplateAmount(id, {}, []);
	const fields = templateFieldsFromAmount(id, amount);
	expect(
		patchTemplateAmount(
			id,
			amount,
			buildTemplateAmount(id, fields, []),
			fields,
		),
	).toEqual(amount);
});
