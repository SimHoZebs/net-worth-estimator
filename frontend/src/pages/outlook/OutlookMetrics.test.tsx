import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testPlan } from "../../test/plan.ts";
import { projectionFixture } from "../../test/projection.ts";
import { OutlookMetrics } from "./OutlookMetrics.tsx";

afterEach(cleanup);

describe("outlook metric frames", () => {
	it("keeps plan context while pending and enables evidence after loading", () => {
		const onEvidence = vi.fn();
		const props = { plan: testPlan, years: 30, onEvidence };
		const view = render(
			<OutlookMetrics {...props} projection={null} pending />,
		);
		expect(screen.getByText("Current net worth")).toBeTruthy();
		expect(screen.getByText("Base case in 2056")).toBeTruthy();
		expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
			true,
		);
		view.rerender(
			<OutlookMetrics {...props} projection={projectionFixture()} />,
		);
		expect(screen.getByText("Base case in 2027")).toBeTruthy();
		expect(screen.getByText("$1,000")).toBeTruthy();
		fireEvent.click(
			screen.getByRole("button", {
				name: "Inspect current net worth evidence",
			}),
		);
		expect(onEvidence).toHaveBeenCalledOnce();
	});
});
