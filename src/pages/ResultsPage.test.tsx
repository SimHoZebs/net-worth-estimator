// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RuntimeFixtureProviders } from "@/test/runtimeFixtures";
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
});
