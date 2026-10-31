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

const unconfirmed = {
	id: "finding",
	runId: "run",
	feedbackRevision: 1,
	strength: "strong",
	stale: false,
	provider: "klarna",
} as AnalysisFinding;

function succeedMutations() {
	mutate.mockImplementation(
		(
			_args: unknown,
			options?: { onSuccess?: () => void; onError?: (error: unknown) => void },
		) => {
			options?.onSuccess?.();
		},
	);
}

// Lets the action-owned post-commit focus handoff run: the handoff schedules
// first, so awaiting a frame plus a timer guarantees it has fired.
async function flushFocus(rounds = 3) {
	for (let i = 0; i < rounds; i++) {
		await new Promise<void>((resolve) => {
			if (typeof requestAnimationFrame === "function") {
				requestAnimationFrame(() => setTimeout(() => resolve(), 0));
			} else {
				setTimeout(() => resolve(), 0);
			}
		});
	}
}

afterEach(() => {
	cleanup();
	mutate.mockReset();
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
	it("focuses duration only after an explicit Change, not a background revision", async () => {
		const ui = (finding: AnalysisFinding) => (
			<>
				<button type="button">Elsewhere</button>
				<BNPLConfirmation finding={finding} readOnly={false} />
			</>
		);
		const view = render(ui(confirmed));
		fireEvent.click(screen.getByRole("button", { name: "Change" }));
		await flushFocus();
		expect(document.activeElement).toBe(
			screen.getByRole("spinbutton", { name: "Duration" }),
		);
		const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
		elsewhere.focus();
		view.rerender(ui({ ...confirmed, feedbackRevision: 2 }));
		expect(document.activeElement).toBe(elsewhere);
	});
	it("focuses duration after Yes and returns focus to Change after save", async () => {
		succeedMutations();
		const view = render(
			<BNPLConfirmation finding={unconfirmed} readOnly={false} />,
		);
		fireEvent.click(screen.getByRole("button", { name: "Yes" }));
		expect(mutate).toHaveBeenCalledWith(
			expect.objectContaining({
				input: expect.objectContaining({ action: "confirm" }),
			}),
			expect.any(Object),
		);
		// The confirmed finding arrives after the mutation resolves.
		view.rerender(
			<BNPLConfirmation
				finding={{
					...unconfirmed,
					feedbackRevision: 2,
					review: {
						decision: "confirmed",
						provider: "klarna",
						answeredAt: 2,
					},
				}}
				readOnly={false}
			/>,
		);
		await flushFocus();
		const duration = screen.getByRole("spinbutton", { name: "Duration" });
		expect(document.activeElement).toBe(duration);
		fireEvent.change(duration, { target: { value: "6" } });
		fireEvent.change(screen.getByRole("combobox", { name: "Unit" }), {
			target: { value: "weeks" },
		});
		fireEvent.submit(duration.closest("form")!);
		expect(mutate).toHaveBeenLastCalledWith(
			expect.objectContaining({
				input: expect.objectContaining({
					action: "set-duration",
					duration: { count: 6, unit: "weeks" },
				}),
			}),
			expect.any(Object),
		);
		// The save completion hands focus to the already-visible Change button.
		await flushFocus();
		expect(screen.getByRole("button", { name: "Change" })).toBe(
			document.activeElement,
		);
	});
	it("moves focus to Change after saving an edited duration", async () => {
		succeedMutations();
		render(<BNPLConfirmation finding={confirmed} readOnly={false} />);
		fireEvent.click(screen.getByRole("button", { name: "Change" }));
		const duration = screen.getByRole("spinbutton", { name: "Duration" });
		fireEvent.change(duration, { target: { value: "6" } });
		fireEvent.submit(duration.closest("form")!);
		expect(mutate).toHaveBeenLastCalledWith(
			expect.objectContaining({
				input: expect.objectContaining({
					action: "set-duration",
					duration: { count: 6, unit: "months" },
				}),
			}),
			expect.any(Object),
		);
		expect(screen.queryByRole("spinbutton", { name: "Duration" })).toBeNull();
		await flushFocus();
		expect(screen.getByRole("button", { name: "Change" })).toBe(
			document.activeElement,
		);
	});
	it("keeps an in-progress duration across background revisions", () => {
		const ui = (finding: AnalysisFinding) => (
			<>
				<button type="button">Elsewhere</button>
				<BNPLConfirmation finding={finding} readOnly={false} />
			</>
		);
		const view = render(ui(confirmed));
		fireEvent.click(screen.getByRole("button", { name: "Change" }));
		const duration = screen.getByRole("spinbutton", {
			name: "Duration",
		}) as HTMLInputElement;
		fireEvent.change(duration, { target: { value: "6" } });
		expect(duration.value).toBe("6");
		const elsewhere = screen.getByRole("button", { name: "Elsewhere" });
		elsewhere.focus();
		view.rerender(ui({ ...confirmed, feedbackRevision: 2 }));
		expect(
			(screen.getByRole("spinbutton", { name: "Duration" }) as HTMLInputElement)
				.value,
		).toBe("6");
		expect(document.activeElement).toBe(elsewhere);
	});
	it("hides editing controls in read-only mode", () => {
		render(<BNPLConfirmation finding={confirmed} readOnly={true} />);
		expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
		expect(screen.queryByRole("button", { name: "Yes" })).toBeNull();
		expect(screen.queryByRole("spinbutton", { name: "Duration" })).toBeNull();
		expect(screen.getByText("BNPL", { exact: true })).toBeTruthy();
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
