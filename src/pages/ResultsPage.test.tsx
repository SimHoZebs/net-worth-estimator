// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import {
	createStochasticProgressFixture,
	RuntimeFixtureProviders,
} from "@/test/runtimeFixtures";
import { ResultsPage } from "./ResultsPage";

vi.mock("@/components/ProjectionDashboard", () => ({
	ProjectionDashboard: () => <div>Dashboard</div>,
}));

afterEach(cleanup);

describe("ResultsPage", () => {
	it("shows an initial source failure and provides recovery", () => {
		const onReload = vi.fn();
		const router = createMemoryRouter([
			{
				path: "/",
				element: (
					<RuntimeFixtureProviders
						model={{ loadError: "Source unavailable", reload: onReload }}
					>
						<Outlet />
					</RuntimeFixtureProviders>
				),
				children: [
					{ index: true, element: <ResultsPage /> },
					{ path: "model-inputs", element: <div>Inputs</div> },
				],
			},
		]);

		render(<RouterProvider router={router} />);

		expect(screen.getByRole("alert").textContent).toContain(
			"Source unavailable",
		);
		fireEvent.click(screen.getByRole("button", { name: "Retry loading" }));
		expect(onReload).toHaveBeenCalledOnce();
		expect(
			screen.getByRole("link", { name: "Open model inputs" }),
		).not.toBeNull();
	});

	it("shows deterministic and stochastic worker activity with progress", () => {
		const router = createMemoryRouter([
			{
				path: "/",
				element: (
					<RuntimeFixtureProviders
						model={{ document: createBaseDocument() }}
						execution={{
							isProjecting: true,
							isStochasticRunning: true,
						}}
						stochasticProgress={createStochasticProgressFixture({
							completedRuns: 370,
							fraction: 0.37,
							evaluationWorkloads: [
								{
									type: "financialIndependence",
									instanceId: "fi",
									label: "Financial independence",
									completedUnits: 22_570,
									totalUnits: 61_000,
									unitLabel: "monthly start dates",
									unitAction: "checked",
									intensiveUnitsCompleted: 1_246,
									intensiveUnitLabel: "candidate sustainability cycles",
									intensiveUnitAction: "attempted",
								},
							],
						})}
					>
						<ResultsPage />
					</RuntimeFixtureProviders>
				),
			},
		]);

		render(<RouterProvider router={router} />);

		const activity = screen.getByRole("alert");
		expect(activity.textContent).toContain(
			"Updating projection and Monte Carlo analysis",
		);
		expect(activity.textContent).toContain("37%");
		expect(activity.textContent).toContain("370 / 1,000 Monte Carlo paths");
		expect(activity.textContent).toContain(
			"22,570 / 61,000 monthly start dates checked",
		);
		expect(activity.textContent).toContain(
			"1,246 candidate sustainability cycles attempted",
		);
	});

	it("shows stochastic activity after deterministic evaluation finishes", () => {
		const router = createMemoryRouter([
			{
				path: "/",
				element: (
					<RuntimeFixtureProviders
						model={{ document: createBaseDocument() }}
						execution={{ isStochasticRunning: true }}
						stochasticProgress={createStochasticProgressFixture({
							completedRuns: 640,
							fraction: 0.64,
						})}
					>
						<ResultsPage />
					</RuntimeFixtureProviders>
				),
			},
		]);

		render(<RouterProvider router={router} />);

		const activity = screen.getByRole("alert");
		expect(activity.textContent).toContain("Updating Monte Carlo analysis");
		expect(activity.textContent).toContain("64%");
	});

	it("shows deterministic activity without Monte Carlo", () => {
		const router = createMemoryRouter([
			{
				path: "/",
				element: (
					<RuntimeFixtureProviders
						model={{ document: createBaseDocument() }}
						execution={{ isProjecting: true }}
					>
						<ResultsPage />
					</RuntimeFixtureProviders>
				),
			},
		]);

		render(<RouterProvider router={router} />);

		const activity = screen.getByRole("alert");
		expect(activity.textContent).toContain("Updating projection");
		expect(activity.textContent).not.toContain("Monte Carlo");
	});
});
