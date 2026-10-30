import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { financialModelFixture } from "../../mocks/financialModel.ts";
import { evaluationFixture } from "../../mocks/projection.ts";
import { EvaluationCard } from "./EvaluationCard.tsx";

afterEach(cleanup);

const evaluation = financialModelFixture.evaluations[0]!;

describe("EvaluationCard", () => {
	it("preserves icon actions and pin state without an evidence action", () => {
		const onEdit = vi.fn();
		const onRemove = vi.fn();
		const onPinChange = vi.fn();
		const view = render(
			<EvaluationCard
				evaluation={evaluation}
				result={{ current: 500000, firstDate: "2028-06-01" }}
				onEdit={onEdit}
				onRemove={onRemove}
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
		expect(view.queryByRole("button", { name: /Evidence/ })).toBeNull();
		for (const action of [onPinChange, onEdit, onRemove])
			expect(action).toHaveBeenCalledOnce();
		expect(
			view.getByRole("progressbar", { name: evaluation.name }),
		).toBeTruthy();
		expect(view.queryByText(/of modeled scenarios/)).toBeNull();
	});

	it("keeps pending outcomes and paused evaluations explicit", () => {
		const props = {
			evaluation,
			result: undefined,
			pending: true,
		};
		const view = render(<EvaluationCard {...props} />);
		expect(view.queryByRole("button", { name: /Evidence/ })).toBeNull();
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
		expect(view.queryByRole("button", { name: /Evidence/ })).toBeNull();
	});

	it.each(financialModelFixture.evaluations)(
		"keeps the $kind target result and editor actions without evidence",
		(evaluation) => {
			const onEdit = vi.fn();
			const onRemove = vi.fn();
			const view = render(
				<EvaluationCard
					evaluation={evaluation}
					result={evaluationFixture({ evaluation })}
					onEdit={onEdit}
					onRemove={onRemove}
				/>,
			);
			expect(view.getByRole("heading", { name: evaluation.name })).toBeTruthy();
			expect(
				view.getByRole("progressbar", { name: evaluation.name }),
			).toBeTruthy();
			expect(view.queryByText(/of modeled scenarios/)).toBeNull();
			expect(view.queryByRole("button", { name: /Evidence/ })).toBeNull();
			fireEvent.click(
				view.getByRole("button", { name: `Edit ${evaluation.name}` }),
			);
			expect(onEdit).toHaveBeenCalledOnce();
			fireEvent.click(
				view.getByRole("button", { name: `Remove ${evaluation.name}` }),
			);
			expect(onRemove).toHaveBeenCalledOnce();
		},
	);
});
