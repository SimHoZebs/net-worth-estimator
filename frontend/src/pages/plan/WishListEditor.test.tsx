import { cleanup, fireEvent, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Plan } from "../../domain/model.ts";
import { testPlan } from "../../test/plan.ts";
import { WishListEditor } from "./WishListEditor.tsx";

vi.mock("../../components/ui.tsx", async (importOriginal) => ({
	...(await importOriginal<typeof import("../../components/ui.tsx")>()),
	Modal: ({ children }: { children: ReactNode }) => (
		<section>{children}</section>
	),
}));

afterEach(cleanup);

describe("WishListEditor", () => {
	it("shows the actual workspace rejection instead of a silent apply", () => {
		const view = render(
			<WishListEditor
				plan={testPlan}
				item={null}
				onApply={() => false}
				onClose={() => {}}
				readOnly={false}
				applyError="The authoritative plan changed. Reload before editing."
			/>,
		);
		fireEvent.change(view.getByLabelText("Purchase name"), {
			target: { value: "Desk" },
		});
		fireEvent.change(view.getByLabelText("Cost (USD)"), {
			target: { value: "400" },
		});
		fireEvent.submit(
			view
				.getByRole("button", { name: "Apply unsaved changes" })
				.closest("form")!,
		);
		expect(view.getByRole("alert").textContent).toContain(
			"The authoritative plan changed. Reload before editing.",
		);
	});

	it("reports a refused apply inside the form and preserves its values", () => {
		const onApply = vi.fn(() => false);
		const onClose = vi.fn();
		const view = render(
			<WishListEditor
				plan={testPlan}
				item={null}
				onApply={onApply}
				onClose={onClose}
				readOnly={false}
			/>,
		);
		fireEvent.change(view.getByLabelText("Purchase name"), {
			target: { value: "Desk" },
		});
		fireEvent.change(view.getByLabelText("Cost (USD)"), {
			target: { value: "400" },
		});
		fireEvent.submit(
			view
				.getByRole("button", { name: "Apply unsaved changes" })
				.closest("form")!,
		);
		expect(view.getByRole("alert").textContent).toContain(
			"could not be applied",
		);
		expect(
			(view.getByLabelText("Purchase name") as HTMLInputElement).value,
		).toBe("Desk");
		expect(onApply).toHaveBeenCalledOnce();
		expect(onClose).not.toHaveBeenCalled();
	});

	it("preserves labeled native fields and checkbox form values", () => {
		const onApply = vi.fn<(plan: Plan) => boolean>(() => true);
		const onClose = vi.fn();
		const view = render(
			<WishListEditor
				plan={testPlan}
				item={null}
				onApply={onApply}
				onClose={onClose}
				readOnly={false}
			/>,
		);
		fireEvent.change(view.getByLabelText("Purchase name"), {
			target: { value: "Desk" },
		});
		fireEvent.change(view.getByLabelText("Cost (USD)"), {
			target: { value: "400.25" },
		});
		const account = view.getByLabelText("Funding account") as HTMLSelectElement;
		expect(account.value).toBe("checking");
		const date = view.getByLabelText(
			"Earliest purchase date",
		) as HTMLInputElement;
		expect(date.type).toBe("date");
		expect(date.value).toBe(testPlan.startDate);
		const include = view.getByRole("checkbox", {
			name: "Include in purchase queue",
		}) as HTMLInputElement;
		expect(include.checked).toBe(true);
		fireEvent.click(include);
		fireEvent.submit(
			view
				.getByRole("button", { name: "Apply unsaved changes" })
				.closest("form")!,
		);
		expect(onApply).toHaveBeenCalledOnce();
		expect(onApply.mock.calls[0]![0].movements.at(-1)).toMatchObject({
			name: "Desk",
			amount: 400.25,
			fromId: "checking",
			startDate: testPlan.startDate,
			enabled: false,
			purchasePriority: 0,
		});
		expect(onClose).toHaveBeenCalledOnce();
	});

	it("retains the read-only fieldset and blocked submit action", () => {
		const onApply = vi.fn<(plan: Plan) => boolean>(() => true);
		const view = render(
			<WishListEditor
				plan={testPlan}
				item={null}
				onApply={onApply}
				onClose={() => {}}
				readOnly
			/>,
		);
		const field = view.getByRole("checkbox", {
			name: "Include in purchase queue",
		});
		expect(field.closest("fieldset")?.disabled).toBe(true);
		expect(
			(
				view.getByRole("button", {
					name: "Apply unsaved changes",
				}) as HTMLButtonElement
			).disabled,
		).toBe(true);
		fireEvent.submit(field.closest("form")!);
		expect(onApply).not.toHaveBeenCalled();
	});
});
