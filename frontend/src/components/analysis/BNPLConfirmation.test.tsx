import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AnalysisFinding } from "@/api/generated/model/analysisFinding.ts";
import { BNPLConfirmation } from "./BNPLConfirmation.tsx";

const mutate = vi.hoisted(() => vi.fn());
vi.mock("@/state/analyses.ts", () => ({
	useReviewAnalysisFinding: () => ({
		mutate,
		isPending: false,
		isError: false,
	}),
}));

const confirmed = {
	id: "finding",
	runId: "run",
	feedbackRevision: 1,
	strength: "strong",
	stale: false,
	review: {
		decision: "confirmed",
		provider: "klarna",
		answeredAt: 1,
		duration: { count: 3, unit: "months" },
	},
} as AnalysisFinding;

afterEach(() => {
	cleanup();
	mutate.mockClear();
});

describe("BNPL confirmation controls", () => {
	it("keeps stale confirmation readable without opening a disabled question", () => {
		render(
			<BNPLConfirmation
				finding={{ ...confirmed, stale: true }}
				readOnly={false}
			/>,
		);
		expect(screen.getByText("Awaiting analysis")).toBeTruthy();
		expect(
			(screen.getByRole("button", { name: "Change" }) as HTMLButtonElement)
				.disabled,
		).toBe(true);
		expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
	});
	it("focuses duration only after an explicit Change, not a background revision", () => {
		const ui = (finding: AnalysisFinding) => (
			<>
				<button type="button">Elsewhere</button>
				<BNPLConfirmation finding={finding} readOnly={false} />
			</>
		);
		const view = render(ui(confirmed));
		fireEvent.click(screen.getByRole("button", { name: "Change" }));
		expect(document.activeElement).toBe(
			screen.getByRole("spinbutton", { name: "Duration" }),
		);
		const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
		elsewhere.focus();
		view.rerender(ui({ ...confirmed, feedbackRevision: 2 }));
		expect(document.activeElement).toBe(elsewhere);
	});
	it("blocks invalid durations even when a submit bypasses native validation", () => {
		render(
			<BNPLConfirmation
				finding={{
					...confirmed,
					review: { ...confirmed.review!, duration: undefined },
				}}
				readOnly={false}
			/>,
		);
		const input = screen.getByRole("spinbutton", { name: "Duration" });
		const form = input.closest("form")!;
		for (const value of ["", "0", "3.5", "5201"]) {
			fireEvent.change(input, { target: { value } });
			fireEvent.submit(form);
		}
		expect(mutate).not.toHaveBeenCalled();
		fireEvent.change(input, { target: { value: "6" } });
		fireEvent.submit(form);
		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				input: expect.objectContaining({
					action: "set-duration",
					duration: { count: 6, unit: "months" },
				}),
			}),
			expect.any(Object),
		);
	});
});
