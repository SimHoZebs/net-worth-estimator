import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	Checkbox,
	Field,
	Input,
	InputField,
	SearchField,
	Select,
	SelectField,
	TextArea,
	TextAreaField,
} from "./Field.tsx";
import {
	checkboxStyles,
	controlStyles,
	fieldStyles,
	type ControlStyleProps,
	type FieldStyleProps,
} from "./fieldStyles.ts";

afterEach(cleanup);

describe("field controls", () => {
	it("forwards native input props, refs, and external form ownership", () => {
		const ref = createRef<HTMLInputElement>();
		const view = render(
			<>
				<form id="account" />
				<InputField
					ref={ref}
					label="Balance"
					id="balance"
					name="balance"
					form="account"
					type="number"
					defaultValue="12.50"
					required
					min="0"
					max="100"
					step="0.01"
					autoComplete="off"
					inputMode="decimal"
					data-owner="account"
				/>
			</>,
		);
		const input = view.getByLabelText("Balance") as HTMLInputElement;
		expect(ref.current).toBe(input);
		expect(input.id).toBe("balance");
		expect(input.required).toBe(true);
		expect([input.min, input.max, input.step]).toEqual(["0", "100", "0.01"]);
		expect(input.autocomplete).toBe("off");
		expect(input.inputMode).toBe("decimal");
		expect(input.dataset.owner).toBe("account");
		expect(input.form?.id).toBe("account");
		expect(new FormData(input.form!).get("balance")).toBe("12.50");
	});

	it("composes existing descriptions with the hint", () => {
		const view = render(
			<>
				<p id="help">Shared help</p>
				<p id="error">Validation detail</p>
				<InputField
					label="Amount"
					id="amount"
					hint="Use dollars."
					aria-describedby="help error"
				/>
			</>,
		);
		const input = view.getByRole("textbox", { name: "Amount" });
		expect(input.getAttribute("aria-describedby")).toBe(
			"help error amount-hint",
		);
		expect(view.getByText("Use dollars.").id).toBe("amount-hint");
	});

	it("preserves caller descriptions when no hint exists", () => {
		const view = render(
			<InputField label="Name" aria-describedby="existing" />,
		);
		expect(view.getByLabelText("Name").getAttribute("aria-describedby")).toBe(
			"existing",
		);
	});

	it("generates unique label and hint associations", () => {
		const view = render(
			<>
				<InputField label="First" hint="First hint" />
				<InputField label="Second" hint="Second hint" />
			</>,
		);
		const first = view.getByLabelText("First");
		const second = view.getByLabelText("Second");
		expect(first.id).not.toBe(second.id);
		expect(first.getAttribute("aria-describedby")).toBe(
			view.getByText("First hint").id,
		);
		expect(second.getAttribute("aria-describedby")).toBe(
			view.getByText("Second hint").id,
		);
	});

	it("keeps input class overrides separate from wrapper overrides", () => {
		const view = render(
			<InputField
				label="Name"
				wide
				className="h-14 rounded-full bg-surface-2 px-5"
				containerClassName="gap-4"
			/>,
		);
		const input = view.getByLabelText("Name");
		expect(input.classList.contains("h-14")).toBe(true);
		expect(input.classList.contains("h-11")).toBe(false);
		expect(input.classList.contains("rounded-control")).toBe(false);
		expect(input.classList.contains("bg-input-bg")).toBe(false);
		expect(input.classList.contains("px-3")).toBe(false);
		expect(input.parentElement?.classList.contains("col-span-full")).toBe(true);
		expect(input.parentElement?.classList.contains("gap-4")).toBe(true);
		expect(input.parentElement?.classList.contains("gap-2")).toBe(false);
		expect(input.classList.contains("gap-4")).toBe(false);
	});

	it("preserves controlled input values and change events", () => {
		const onChange = vi.fn();
		const view = render(
			<InputField label="Name" value="First" onChange={onChange} />,
		);
		const input = view.getByLabelText("Name") as HTMLInputElement;
		fireEvent.change(input, { target: { value: "Second" } });
		expect(onChange).toHaveBeenCalledOnce();
		view.rerender(
			<InputField label="Name" value="Second" onChange={onChange} />,
		);
		expect(input.value).toBe("Second");
	});

	it("forwards select props, refs, controlled selections, and descriptions", () => {
		const ref = createRef<HTMLSelectElement>();
		const onChange = vi.fn();
		const content = (value: string[]) => (
			<>
				<form id="selection" />
				<SelectField
					ref={ref}
					label="Accounts"
					id="accounts"
					form="selection"
					name="accounts"
					required
					multiple
					size={3}
					value={value}
					onChange={onChange}
					hint="Choose accounts."
					aria-describedby="shared-help"
					className="h-24"
				>
					<option value="cash">Cash</option>
					<option value="savings">Savings</option>
				</SelectField>
			</>
		);
		const view = render(content(["cash"]));
		const select = view.getByLabelText("Accounts") as HTMLSelectElement;
		expect(ref.current).toBe(select);
		expect(select.required).toBe(true);
		expect(select.multiple).toBe(true);
		expect(select.size).toBe(3);
		expect(select.getAttribute("aria-describedby")).toBe(
			"shared-help accounts-hint",
		);
		expect(select.classList.contains("h-11")).toBe(false);
		fireEvent.change(select, { target: { value: "savings" } });
		expect(onChange).toHaveBeenCalledOnce();
		view.rerender(content(["cash", "savings"]));
		expect(new FormData(select.form!).getAll("accounts")).toEqual([
			"cash",
			"savings",
		]);
	});

	it("forwards textarea props, refs, form ownership, and hint descriptions", () => {
		const ref = createRef<HTMLTextAreaElement>();
		const view = render(
			<>
				<form id="recipe" />
				<TextAreaField
					ref={ref}
					label="Recipe"
					id="recipe-data"
					form="recipe"
					name="data"
					required
					rows={4}
					maxLength={200}
					defaultValue="Saved data"
					hint="Use JSON."
					aria-describedby="shared-help"
					className="min-h-32 px-5"
				/>
			</>,
		);
		const textarea = view.getByLabelText("Recipe") as HTMLTextAreaElement;
		expect(ref.current).toBe(textarea);
		expect(textarea.required).toBe(true);
		expect(textarea.rows).toBe(4);
		expect(textarea.maxLength).toBe(200);
		expect(textarea.getAttribute("aria-describedby")).toBe(
			"shared-help recipe-data-hint",
		);
		expect(textarea.classList.contains("min-h-[6lh]")).toBe(false);
		expect(textarea.classList.contains("px-3")).toBe(false);
		expect(new FormData(textarea.form!).get("data")).toBe("Saved data");
	});

	it("preserves controlled textarea values and events", () => {
		const onChange = vi.fn();
		const view = render(
			<TextAreaField label="Data" value="First" onChange={onChange} />,
		);
		const textarea = view.getByLabelText("Data") as HTMLTextAreaElement;
		fireEvent.change(textarea, { target: { value: "Second" } });
		expect(onChange).toHaveBeenCalledOnce();
		view.rerender(
			<TextAreaField label="Data" value="Second" onChange={onChange} />,
		);
		expect(textarea.value).toBe("Second");
	});

	it("exports standalone native controls without field ancestors", () => {
		const input = createRef<HTMLInputElement>();
		const select = createRef<HTMLSelectElement>();
		const textarea = createRef<HTMLTextAreaElement>();
		const view = render(
			<form>
				<Input
					ref={input}
					aria-label="Input"
					name="input"
					defaultValue="Native"
					readOnly
				/>
				<Select
					ref={select}
					aria-label="Select"
					name="select"
					defaultValue="cash"
					disabled
				>
					<option value="cash">Cash</option>
				</Select>
				<TextArea
					ref={textarea}
					aria-label="Text area"
					name="textarea"
					defaultValue="Text"
				/>
			</form>,
		);
		expect(input.current).toBe(view.getByLabelText("Input"));
		expect(input.current?.readOnly).toBe(true);
		expect(select.current).toBe(view.getByLabelText("Select"));
		expect(select.current?.disabled).toBe(true);
		expect(textarea.current).toBe(view.getByLabelText("Text area"));
		for (const ref of [input, select, textarea]) {
			expect(ref.current?.classList.contains("rounded-control")).toBe(true);
			expect(ref.current?.classList.contains("border-line-strong")).toBe(true);
		}
	});

	it("preserves checkbox native props, controlled state, and class overrides", () => {
		const ref = createRef<HTMLInputElement>();
		const onChange = vi.fn();
		const view = render(
			<>
				<form id="settings" />
				<label htmlFor="enabled">
					<Checkbox
						id="enabled"
						ref={ref}
						form="settings"
						name="enabled"
						value="yes"
						required
						checked
						onChange={onChange}
						className="size-6"
					/>
					Enabled
				</label>
			</>,
		);
		const checkbox = view.getByRole("checkbox", {
			name: "Enabled",
		}) as HTMLInputElement;
		expect(ref.current).toBe(checkbox);
		expect(checkbox.required).toBe(true);
		expect(checkbox.checked).toBe(true);
		expect(checkbox.classList.contains("size-5")).toBe(false);
		expect(new FormData(checkbox.form!).get("enabled")).toBe("yes");
		fireEvent.click(checkbox);
		expect(onChange).toHaveBeenCalledOnce();
	});

	it("supports the field wrapper with any native control recipe", () => {
		const view = render(
			<Field label="Custom" hint="Custom hint" describedBy="shared-help">
				{(props) => <Input {...props} name="custom" />}
			</Field>,
		);
		const control = view.getByLabelText("Custom");
		expect(control.getAttribute("aria-describedby")).toBe(
			`shared-help ${control.id}-hint`,
		);
	});
});

describe("search field", () => {
	it("labels the input and keeps input and wrapper classes separate", () => {
		const view = render(
			<SearchField
				label="Search transactions"
				placeholder="Search"
				className="w-64 sm:w-64 px-3"
				containerClassName="gap-4 text-muted"
			/>,
		);
		const input = view.getByRole("textbox", { name: "Search transactions" });
		expect(input.getAttribute("type")).toBeNull();
		expect(input.getAttribute("placeholder")).toBe("Search");
		expect(input.classList.contains("w-64")).toBe(true);
		expect(input.classList.contains("w-32")).toBe(false);
		expect(input.classList.contains("px-1")).toBe(false);
		expect(input.parentElement?.classList.contains("gap-4")).toBe(true);
		expect(input.parentElement?.classList.contains("gap-2")).toBe(false);
		expect(input.parentElement?.classList.contains("w-64")).toBe(false);
		expect(
			input.parentElement?.querySelector("svg")?.getAttribute("aria-hidden"),
		).toBe("true");
	});

	it("forwards native search props, refs, external form, and controlled values", () => {
		const ref = createRef<HTMLInputElement>();
		const onChange = vi.fn();
		const content = (value: string) => (
			<>
				<form id="search" />
				<SearchField
					ref={ref}
					label="Search"
					id="query"
					type="search"
					form="search"
					name="query"
					required
					value={value}
					onChange={onChange}
					aria-describedby="query-help"
				/>
			</>
		);
		const view = render(content("rent"));
		const input = view.getByRole("searchbox", {
			name: "Search",
		}) as HTMLInputElement;
		expect(ref.current).toBe(input);
		expect(input.id).toBe("query");
		expect(input.required).toBe(true);
		expect(input.getAttribute("aria-describedby")).toBe("query-help");
		expect(new FormData(input.form!).get("query")).toBe("rent");
		fireEvent.change(input, { target: { value: "salary" } });
		expect(onChange).toHaveBeenCalledOnce();
		view.rerender(content("salary"));
		expect(input.value).toBe("salary");
	});
});

it("exports typed field and control recipes for native markup", () => {
	const field: FieldStyleProps = { wide: true };
	const control: ControlStyleProps = { kind: "textarea" };
	expect(fieldStyles(field)).toContain("col-span-full");
	expect(controlStyles(control)).toContain("resize-y");
	expect(controlStyles({ kind: "search" })).not.toContain("border-line-strong");
	expect(checkboxStyles()).toContain("accent-primary");
});
