import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { testPlan } from "../../mocks/plan.ts";
import { projectionFixture } from "../../mocks/projection.ts";
import { OutlookMetrics } from "./OutlookMetrics.tsx";

afterEach(cleanup);

describe("outlook metric frames", () => {
	it("keeps plan context while pending and enables evidence after loading", () => {
		const onEvidence = vi.fn();
		const position = {
			data: null,
			status: "pending" as const,
			error: null,
			retry: vi.fn(),
		};
		const props = { plan: testPlan, years: 30, onEvidence, position };
		const view = render(
			<OutlookMetrics {...props} projection={null} pending />,
		);
		expect(screen.getByText("Current net worth")).toBeTruthy();
		expect(screen.getByText("Base case in 2056")).toBeTruthy();
		expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
			true,
		);
		view.rerender(
			<OutlookMetrics
				{...props}
				position={{
					...position,
					status: "success",
					data: { asOfDate: testPlan.startDate, netWorth: 1000, accounts: [] },
				}}
				projection={projectionFixture()}
			/>,
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

	it("displays current position and enables evidence while the forecast stays pending", () => {
		render(
			<OutlookMetrics
				plan={testPlan}
				years={30}
				onEvidence={vi.fn()}
				projection={null}
				pending
				position={{
					data: { asOfDate: testPlan.startDate, netWorth: 1234, accounts: [] },
					status: "success",
					error: null,
					retry: vi.fn(),
				}}
			/>,
		);
		expect(screen.getByText("$1,234")).toBeTruthy();
		expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(
			false,
		);
		expect(
			screen
				.getByText("Base case in 2056")
				.closest("section")
				?.getAttribute("aria-busy"),
		).toBe("true");
		expect(
			screen
				.getByText("Current net worth")
				.closest("section")
				?.getAttribute("aria-busy"),
		).toBe("false");
	});

	it("does not show a forecast skeleton after failure", () => {
		render(
			<OutlookMetrics
				plan={testPlan}
				years={30}
				onEvidence={vi.fn()}
				projection={null}
				position={{
					data: { asOfDate: testPlan.startDate, netWorth: 1234, accounts: [] },
					status: "success",
					error: null,
					retry: vi.fn(),
				}}
			/>,
		);
		expect(screen.getByText("$1,234")).toBeTruthy();
		expect(screen.getByText("Forecast unavailable")).toBeTruthy();
	});
});
