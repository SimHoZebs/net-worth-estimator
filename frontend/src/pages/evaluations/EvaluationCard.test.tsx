import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testPlan } from "../../test/plan.ts";
import { EvaluationCard } from "./EvaluationCard.tsx";

afterEach(cleanup);

const evaluation = testPlan.evaluations[0]!;

describe("EvaluationCard", () => {
	it("preserves icon actions, pin state, and the evidence action", () => {
		const onEdit = vi.fn();
		const onRemove = vi.fn();
		const onEvidence = vi.fn();
		const onPinChange = vi.fn();
		const view = render(
			<EvaluationCard
				evaluation={evaluation}
				result={{ current: 500000, firstDate: "2028-06-01" }}
				probability={0.75}
				onEdit={onEdit}
				onRemove={onRemove}
				onEvidence={onEvidence}
				pin={{ pinned: true, onPinChange }}
			/>,
		);
		const pin = view.getByRole("button", {
			name: `Unpin ${evaluation.name} from Outlook`,
		});
		expect(pin.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(pin);
		fireEvent.click(
			view.getByRole("button", { name: `Edit ${evaluation.name}` }),
		);
		fireEvent.click(
			view.getByRole("button", { name: `Remove ${evaluation.name}` }),
		);
		fireEvent.click(view.getByRole("button", { name: "Evidence" }));
		for (const action of [onPinChange, onEdit, onRemove, onEvidence])
			expect(action).toHaveBeenCalledOnce();
		expect(
			view.getByRole("progressbar", { name: evaluation.name }),
		).toBeTruthy();
		expect(view.getByText("75%", { exact: false })).toBeTruthy();
	});

	it("keeps pending outcomes and paused evaluations unavailable as evidence", () => {
		const props = {
			evaluation,
			result: undefined,
			probability: null,
			onEvidence: vi.fn(),
			pending: true,
		};
		const view = render(<EvaluationCard {...props} />);
		expect(
			(view.getByRole("button", { name: "Evidence" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(
			view
				.getByRole("region", { name: evaluation.name })
				.getAttribute("aria-busy"),
		).toBe("true");
		view.rerender(
			<EvaluationCard
				{...props}
				pending={false}
				evaluation={{ ...evaluation, enabled: false }}
			/>,
		);
		expect(view.getByText("Paused")).toBeTruthy();
		expect(view.getByText("Excluded from evaluation")).toBeTruthy();
		expect(
			(view.getByRole("button", { name: "Evidence" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
	});
});
