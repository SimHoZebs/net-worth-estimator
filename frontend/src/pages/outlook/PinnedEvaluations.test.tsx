import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OtherEvaluation } from "../../domain/result.ts";
import { testPlan } from "../../mocks/plan.ts";
import {
	evaluationFixture,
	projectionFixture,
} from "../../mocks/projection.ts";
import { PinnedEvaluations } from "./PinnedEvaluations.tsx";

afterEach(cleanup);

const funding: OtherEvaluation = {
	id: "funding",
	name: "Test evaluation",
	type: "postingFulfillment",
	enabled: true,
	status: "satisfied",
	goal: null,
	outcomeDate: null,
	outcomeText: "Test outcome",
	qualifier: null,
	progress: null,
	postingIds: null,
};

function props() {
	return {
		plan: testPlan,
		projection: projectionFixture({ otherEvaluations: [funding] }),
		range: null,
		pinnedIds: [funding.id],
		onPinChange: vi.fn(),
	};
}

describe("pinned evaluation cards", () => {
	it.each([null, [], ["unknown"]])(
		"has no fallback card for pins %j",
		(pinnedIds) => {
			const view = render(
				<PinnedEvaluations {...props()} pinnedIds={pinnedIds} />,
			);
			expect(view.container.childElementCount).toBe(0);
		},
	);

	it("changes the selected pin and removes it when unpinned", () => {
		const input = props();
		const view = render(<PinnedEvaluations {...input} />);
		const region = view.getByRole("region", { name: funding.name });
		const button = within(region).getByRole("button", { pressed: true });
		expect(button.getAttribute("aria-pressed")).toBe("true");
		fireEvent.click(button);
		expect(input.onPinChange).toHaveBeenCalledWith(funding.id);
		view.rerender(<PinnedEvaluations {...input} pinnedIds={[]} />);
		expect(view.container.childElementCount).toBe(0);
	});

	it("disables pin changes in read-only mode", () => {
		const input = props();
		const view = render(<PinnedEvaluations {...input} pinsDisabled />);
		const button = view.getByRole("button", { pressed: true });
		expect((button as HTMLButtonElement).disabled).toBe(true);
		fireEvent.click(button);
		expect(input.onPinChange).not.toHaveBeenCalled();
	});

	it.each(testPlan.evaluations)(
		"shows and pins the configured $kind target without an evidence action",
		(evaluation) => {
			const result = evaluationFixture({ evaluation });
			const input = {
				...props(),
				projection: projectionFixture({ evaluations: [result] }),
				range: {
					points: [],
					count: 400,
					evaluationSuccess: { [evaluation.id]: 0.75 },
					failureShare: 0,
				},
				pinnedIds: [evaluation.id],
			};
			const view = render(<PinnedEvaluations {...input} />);
			const card = within(view.getByRole("region", { name: evaluation.name }));
			const progress = card.getByRole("progressbar", { name: evaluation.name });
			expect(Number(progress.getAttribute("aria-valuenow"))).toBe(
				Math.round(
					Math.min(
						100,
						Math.max(0, (result.current / evaluation.target) * 100),
					),
				),
			);
			expect(card.queryByRole("button", { name: /Evidence/ })).toBeNull();
			expect(card.getByText("75%")).toBeTruthy();
			fireEvent.click(
				card.getByRole("button", {
					name: `Unpin ${evaluation.name} from Outlook`,
				}),
			);
			expect(input.onPinChange).toHaveBeenCalledWith(evaluation.id);
			view.rerender(<PinnedEvaluations {...input} pinnedIds={[]} />);
			expect(view.container.childElementCount).toBe(0);
		},
	);
});
