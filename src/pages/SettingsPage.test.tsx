// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createMemoryRouter, Outlet, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { AppShell } from "@/components/AppShell";
import { createBaseDocument } from "@/lib/projection/__fixtures__/documents";
import { DEFAULT_EVALUATIONS, useStore } from "@/store";
import { RuntimeFixtureProviders } from "@/test/runtimeFixtures";
import { SettingsPage } from "./SettingsPage";

afterEach(() => {
	cleanup();
	useStore.setState({ evaluations: structuredClone(DEFAULT_EVALUATIONS) });
});

function renderSettingsRoute() {
	const document = createBaseDocument({
		evaluations: structuredClone(DEFAULT_EVALUATIONS),
	});
	const router = createMemoryRouter(
		[
			{
				path: "/",
				element: (
					<RuntimeFixtureProviders
						model={{
							document,
							effectiveDocument: document,
							dataUpdatedAt: 1,
						}}
					>
						<AppShell>
							<Outlet />
						</AppShell>
					</RuntimeFixtureProviders>
				),
				children: [
					{ index: true, element: <h1>Results fixture</h1> },
					{ path: "settings", element: <SettingsPage /> },
					{ path: "model-inputs", element: <h1>Inputs fixture</h1> },
				],
			},
		],
		{ initialEntries: ["/settings"] },
	);
	return render(<RouterProvider router={router} />);
}

describe("SettingsPage", () => {
	it("warns before discarding an unapplied evaluation draft", async () => {
		renderSettingsRoute();
		fireEvent.change(screen.getByLabelText("Target net worth"), {
			target: { value: "1250000" },
		});
		fireEvent.click(screen.getByRole("link", { name: "Results" }));

		const dialog = await screen.findByRole("alertdialog");
		const stayButton = screen.getByRole("button", { name: "Stay on Settings" });
		expect(document.activeElement).toBe(stayButton);
		fireEvent.keyDown(dialog, { key: "Escape" });
		expect(screen.getByRole("heading", { name: "Settings" })).not.toBeNull();

		fireEvent.click(screen.getByRole("link", { name: "Results" }));
		fireEvent.click(
			await screen.findByRole("button", { name: "Discard and leave" }),
		);
		expect(
			await screen.findByRole("heading", { name: "Results fixture" }),
		).not.toBeNull();
	});

	it("blocks beforeunload while an evaluation draft is dirty", () => {
		renderSettingsRoute();
		fireEvent.change(screen.getByLabelText("Target net worth"), {
			target: { value: "1250000" },
		});
		const event = new Event("beforeunload", { cancelable: true });

		window.dispatchEvent(event);

		expect(event.defaultPrevented).toBe(true);

		const updateButton = screen
			.getAllByRole("button", { name: "Update analysis" })
			.find((button) => !(button as HTMLButtonElement).disabled);
		fireEvent.click(updateButton!);
		const cleanEvent = new Event("beforeunload", { cancelable: true });
		window.dispatchEvent(cleanEvent);
		expect(cleanEvent.defaultPrevented).toBe(false);
	});
});
