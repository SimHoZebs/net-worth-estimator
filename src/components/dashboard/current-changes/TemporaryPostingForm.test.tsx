// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__/documents";
import { TemporaryPostingForm } from "./TemporaryPostingForm";

afterEach(cleanup);

function inputFor(label: string): HTMLInputElement {
	const input = screen
		.getByText(label, { exact: true })
		.parentElement?.querySelector("input");
	if (!(input instanceof HTMLInputElement))
		throw new Error(`No input found for ${label}`);
	return input;
}

describe("TemporaryPostingForm", () => {
	it("uses user-facing amount calculation terminology", () => {
		render(
			<TemporaryPostingForm
				postings={[]}
				document={createBaseDocument()}
				onAdd={() => {}}
				onRemove={() => {}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
		expect(screen.getByText("Amount calculation")).not.toBeNull();
		expect(screen.queryByText("Arithmetic")).toBeNull();
	});

	it("preserves blank numeric input until Add validates it", () => {
		const onAdd = vi.fn();
		render(
			<TemporaryPostingForm
				postings={[]}
				document={createBaseDocument()}
				onAdd={onAdd}
				onRemove={() => {}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
		fireEvent.change(inputFor("ID"), { target: { value: "bonus" } });

		const annualRate = inputFor("Annual Rate");
		expect(annualRate.value).toBe("0");
		fireEvent.change(annualRate, { target: { value: "" } });
		expect(annualRate.value).toBe("");
		fireEvent.click(screen.getByRole("button", { name: "Add posting" }));

		expect(onAdd).not.toHaveBeenCalled();
		expect(
			screen.getByText(/Annual rate must be a valid number/),
		).not.toBeNull();
		expect(annualRate.value).toBe("");
	});

	it("parses numeric strings on Add and preserves zero values", () => {
		const onAdd = vi.fn();
		render(
			<TemporaryPostingForm
				postings={[]}
				document={createBaseDocument()}
				onAdd={onAdd}
				onRemove={() => {}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
		fireEvent.change(inputFor("ID"), { target: { value: "bonus" } });
		fireEvent.change(inputFor("Annual Rate"), { target: { value: "0.25" } });
		fireEvent.change(inputFor("Annual Growth Rate"), {
			target: { value: "-0.1" },
		});
		fireEvent.change(inputFor("Volatility"), { target: { value: "0" } });
		fireEvent.change(inputFor("Annual Cap"), { target: { value: "0" } });
		fireEvent.change(inputFor("Priority"), { target: { value: "2" } });

		fireEvent.click(screen.getByRole("button", { name: "Add posting" }));

		expect(onAdd).toHaveBeenCalledWith(
			expect.objectContaining({
				annualRate: 0.25,
				annualGrowthRate: -0.1,
				volatility: 0,
				annualCap: 0,
				priority: 2,
			}),
		);
	});

	it("rejects a posting ID already used by the baseline", () => {
		const onAdd = vi.fn();
		render(
			<TemporaryPostingForm
				postings={[]}
				document={createBaseDocument()}
				onAdd={onAdd}
				onRemove={() => {}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
		fireEvent.change(inputFor("ID"), { target: { value: "salary" } });
		fireEvent.click(screen.getByRole("button", { name: "Add posting" }));

		expect(onAdd).not.toHaveBeenCalled();
		expect(
			screen.getByText('Posting ID "salary" is already in use.'),
		).not.toBeNull();
	});

	it("rejects an ID reserved by an account", () => {
		const onAdd = vi.fn();
		render(
			<TemporaryPostingForm
				postings={[]}
				document={createBaseDocument()}
				reservedIds={["trial-account"]}
				onAdd={onAdd}
				onRemove={() => {}}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "+ Add" }));
		fireEvent.change(inputFor("ID"), { target: { value: "trial-account" } });
		fireEvent.click(screen.getByRole("button", { name: "Add posting" }));

		expect(onAdd).not.toHaveBeenCalled();
		expect(
			screen.getByText('Posting ID "trial-account" is already in use.'),
		).not.toBeNull();
	});
});
