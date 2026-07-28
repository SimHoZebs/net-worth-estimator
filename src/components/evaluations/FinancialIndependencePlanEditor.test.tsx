// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import { DEFAULT_FINANCIAL_INDEPENDENCE_PLAN } from "@/store";
import { FinancialIndependencePlanEditor } from "./FinancialIndependencePlanEditor";

afterEach(cleanup);

describe("FinancialIndependencePlanEditor", () => {
	it("organizes the plan around goal, funding, and success", () => {
		render(
			<FinancialIndependencePlanEditor
				document={createBaseDocument()}
				plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
				sourceRevision={1}
				onApply={vi.fn()}
			/>,
		);

		expect(screen.getByRole("heading", { name: "Goal" })).not.toBeNull();
		expect(screen.getByRole("heading", { name: "Funding" })).not.toBeNull();
		expect(screen.getByRole("heading", { name: "Success" })).not.toBeNull();
		expect(
			screen.getByText(
				"None configured. This plan currently relies on portfolio withdrawals.",
			),
		).not.toBeNull();
		expect(screen.queryByLabelText("salary")).toBeNull();
		expect(screen.getByText("Model details", { exact: true })).not.toBeNull();
		expect(
			screen.getByText("Preserve purchasing power", { exact: true }),
		).not.toBeNull();
		expect(
			screen.getByText(/finish 10 years with selected assets worth at least/),
		).not.toBeNull();
	});

	it("keeps changes local and applies the complete draft once", () => {
		const onApply = vi.fn();
		render(
			<FinancialIndependencePlanEditor
				document={createBaseDocument()}
				plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
				sourceRevision={1}
				onApply={onApply}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Annual spending"), {
			target: { value: "72000" },
		});
		fireEvent.click(screen.getByLabelText("brokerage"));

		expect(onApply).not.toHaveBeenCalled();
		fireEvent.click(screen.getByRole("button", { name: "Update analysis" }));

		expect(onApply).toHaveBeenCalledTimes(1);
		expect(onApply.mock.calls[0]?.[0]).toMatchObject({
			annualExpenseTarget: 72_000,
			sources: [{ type: "asset", accountId: "brokerage", included: true }],
		});
	});

	it("discards a dirty draft when the source revision changes", () => {
		const onApply = vi.fn();
		const view = render(
			<FinancialIndependencePlanEditor
				document={createBaseDocument()}
				plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
				sourceRevision={1}
				onApply={onApply}
			/>,
		);

		fireEvent.click(screen.getByLabelText("brokerage"));
		expect(
			(
				screen.getByRole("button", {
					name: "Update analysis",
				}) as HTMLButtonElement
			).disabled,
		).toBe(false);

		view.rerender(
			<FinancialIndependencePlanEditor
				document={createBaseDocument()}
				plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
				sourceRevision={2}
				onApply={onApply}
			/>,
		);

		expect(
			(screen.getByLabelText("brokerage") as HTMLInputElement).checked,
		).toBe(false);
		expect(
			(
				screen.getByRole("button", {
					name: "Update analysis",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
	});

	it("discards local changes without applying them", () => {
		const onApply = vi.fn();
		render(
			<FinancialIndependencePlanEditor
				document={createBaseDocument()}
				plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
				sourceRevision={1}
				onApply={onApply}
			/>,
		);

		fireEvent.change(screen.getByLabelText("Annual spending"), {
			target: { value: "72000" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));

		expect(
			(screen.getByLabelText("Annual spending") as HTMLInputElement).value,
		).toBe("80000");
		expect(onApply).not.toHaveBeenCalled();
	});

	it("reveals retirement income choices only after the add action", () => {
		render(
			<FinancialIndependencePlanEditor
				document={createBaseDocument()}
				plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
				sourceRevision={1}
				onApply={vi.fn()}
			/>,
		);

		expect(screen.queryByLabelText("salary")).toBeNull();
		fireEvent.click(
			screen.getByRole("button", { name: "Add retirement income" }),
		);

		expect(screen.getByLabelText("salary")).not.toBeNull();
	});

	it("applies the explained ending portfolio policy", () => {
		const onApply = vi.fn();
		render(
			<FinancialIndependencePlanEditor
				document={createBaseDocument()}
				plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
				sourceRevision={1}
				onApply={onApply}
			/>,
		);

		fireEvent.click(screen.getByLabelText("Allow portfolio drawdown"));
		fireEvent.click(screen.getByRole("button", { name: "Update analysis" }));

		expect(onApply.mock.calls[0]?.[0].principalPolicy).toBe("allow-drawdown");
	});

	it("keeps policy choices independent across FI evaluation instances", () => {
		render(
			<>
				<FinancialIndependencePlanEditor
					document={createBaseDocument()}
					plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
					sourceRevision={1}
					onApply={vi.fn()}
				/>
				<FinancialIndependencePlanEditor
					document={createBaseDocument()}
					plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
					sourceRevision={1}
					onApply={vi.fn()}
				/>
			</>,
		);

		const purchasingPowerOptions = screen.getAllByLabelText(
			"Preserve purchasing power",
		) as HTMLInputElement[];
		const drawdownOptions = screen.getAllByLabelText(
			"Allow portfolio drawdown",
		) as HTMLInputElement[];
		fireEvent.click(drawdownOptions[0]!);

		expect(purchasingPowerOptions[1]?.checked).toBe(true);
	});

	it("keeps spendable income and continuing postings mutually exclusive", () => {
		const onApply = vi.fn();
		const base = createBaseDocument();
		const growth = {
			...base.postings.find((posting) => posting.frequency !== "once")!,
			id: "growth",
			label: "Growth",
			destinations: ["brokerage"],
		};
		render(
			<FinancialIndependencePlanEditor
				document={{ ...base, postings: [...base.postings, growth] }}
				plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
				sourceRevision={1}
				onApply={onApply}
			/>,
		);

		fireEvent.click(screen.getByLabelText("brokerage"));
		fireEvent.click(screen.getByText("Model details", { exact: true }));
		fireEvent.click(screen.getByLabelText("Growth"));
		fireEvent.click(
			screen.getByRole("button", { name: "Add retirement income" }),
		);
		expect(screen.getAllByLabelText("Growth")).toHaveLength(1);
		fireEvent.click(screen.getByLabelText("Growth"));
		const growthOptions = screen.getAllByLabelText("Growth");
		fireEvent.click(growthOptions[0]!);
		fireEvent.click(screen.getByRole("button", { name: "Update analysis" }));

		const applied = onApply.mock.calls[0]?.[0];
		expect(applied.continuingPostingIds).not.toContain("growth");
		expect(applied.sources).toContainEqual({
			type: "cashflow",
			postingId: "growth",
			included: true,
		});
	});

	it("does not offer one-time postings as retirement funding", () => {
		const base = createBaseDocument();
		const historical = base.postings.find(
			(posting) => posting.frequency === "once",
		)!;
		render(
			<FinancialIndependencePlanEditor
				document={base}
				plan={DEFAULT_FINANCIAL_INDEPENDENCE_PLAN}
				sourceRevision={1}
				onApply={vi.fn()}
			/>,
		);

		fireEvent.click(screen.getByText("Model details", { exact: true }));
		expect(screen.queryByLabelText(historical.label)).toBeNull();
	});

	it("removes continuing postings hidden by deselecting their last asset", () => {
		const onApply = vi.fn();
		const base = createBaseDocument();
		const plan = {
			...DEFAULT_FINANCIAL_INDEPENDENCE_PLAN,
			sources: [
				{ type: "asset" as const, accountId: "brokerage", included: true },
			],
			continuingPostingIds: ["invest"],
		};
		render(
			<FinancialIndependencePlanEditor
				document={base}
				plan={plan}
				sourceRevision={1}
				onApply={onApply}
			/>,
		);

		fireEvent.click(screen.getByLabelText("brokerage"));
		fireEvent.click(screen.getByRole("button", { name: "Update analysis" }));

		expect(onApply.mock.calls[0]?.[0].continuingPostingIds).toEqual([]);
	});
});
