import { cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OtherEvaluation } from "../../domain/result.ts";
import { testPlan } from "../../test/plan.ts";
import { projectionFixture } from "../../test/projection.ts";
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
		onEvaluation: vi.fn(),
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
		const region = view.getByRole("region");
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
});
