import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testPlan } from "../../mocks/plan.ts";
import { OutlookMetrics } from "./OutlookMetrics.tsx";

afterEach(cleanup);

describe("outlook metric frames", () => {
	it("skeletonizes while pending and enables evidence after loading", () => {
		const onEvidence = vi.fn();
		const position = {
			data: null,
			status: "pending" as const,
			error: null,
			retry: vi.fn(),
		};
		const view = render(
			<OutlookMetrics
				plan={testPlan}
				position={position}
				onEvidence={onEvidence}
			/>,
		);
		expect(screen.getByText("Current net worth")).toBeTruthy();
		expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
			true,
		);
		view.rerender(
			<OutlookMetrics
				plan={testPlan}
				position={{
					...position,
					status: "success",
					data: { asOfDate: testPlan.startDate, netWorth: 1000, accounts: [] },
				}}
				onEvidence={onEvidence}
			/>,
		);
		expect(screen.getByText("$1,000")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Inspect current net worth evidence",
			}),
		);
		expect(onEvidence).toHaveBeenCalledOnce();
	});

	it("retries a failed current position", () => {
		const retry = vi.fn();
		render(
			<OutlookMetrics
				plan={testPlan}
				position={{ data: null, status: "error", error: "boom", retry }}
				onEvidence={vi.fn()}
			/>,
		);
		expect(screen.getByText(/Could not load current position/)).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", { name: "Retry current position" }),
		);
		expect(retry).toHaveBeenCalledOnce();
	});
});
