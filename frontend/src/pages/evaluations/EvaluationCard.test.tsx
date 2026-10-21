import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testPlan } from "../../test/plan.ts";
import { evaluationFixture } from "../../test/projection.ts";
import { EvaluationCard } from "./EvaluationCard.tsx";

afterEach(cleanup);

describe("target evaluation cards", () => {
	it.each(testPlan.evaluations)(
		"keeps the $kind target result and editor actions without evidence",
		(evaluation) => {
			const onEdit = vi.fn();
			const onRemove = vi.fn();
			const view = render(
				<EvaluationCard
					evaluation={evaluation}
					result={evaluationFixture({ evaluation })}
					probability={0.75}
					onEdit={onEdit}
					onRemove={onRemove}
				/>,
			);
			expect(view.getByRole("heading", { name: evaluation.name })).toBeTruthy();
			expect(
				view.getByRole("progressbar", { name: evaluation.name }),
			).toBeTruthy();
			expect(view.getByText("75%")).toBeTruthy();
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
