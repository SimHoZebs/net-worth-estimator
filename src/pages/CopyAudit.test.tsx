// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createBaseDocument } from "@/lib/projection/__fixtures__";
import { DEFAULT_EVALUATIONS, useStore } from "@/store";
import { RuntimeFixtureProviders } from "@/test/runtimeFixtures";
import { AnalysisPage } from "./AnalysisPage";
import { ModelInputsPage } from "./ModelInputsPage";
import { ResultsPage } from "./ResultsPage";
import { SettingsPage } from "./SettingsPage";

vi.mock("@/components/dashboard/FinancialIndependenceChart", () => ({
	FinancialIndependenceChart: () => null,
}));
vi.mock("@/components/dashboard/charts/StackedContributionChart", () => ({
	StackedContributionChart: () => null,
}));
vi.mock("@/components/dashboard/charts/AccountLinesChart", () => ({
	AccountLinesChart: () => null,
}));

/**
 * Copy audit: user-facing text must not explain the interface, restate
 * labels, or announce empty states. Visible text is collected per route
 * (sr-only content excluded) and matched against banned patterns. Add to
 * BANNED when cutting copy so regressions fail here instead of review.
 */
const BANNED: RegExp[] = [
	/Model inputs/,
	/Monte Carlo/,
	/Resample/,
	/\bSeed\b/,
	/sample count/,
	/Simulation failed/,
	/Retry simulation/,
	/simulation inputs/,
	/Monte Carlo paths/,
	/independent .* samples/,
	/Model inputs/,
	/What is included/,
	/Show details/,
	/No shortfalls/,
	/Selected accounts/,
	/Selected cash flow/,
	/[Tt]ap (the )?chart/,
	/Hover for values/,
	/How the simulation works/,
	/Model boundaries/,
	/No posting requests are underfulfilled/,
	/No debt accounts are currently tracked/,
	/No scheduled transactions are enabled/,
	/Show all \d+ accounts/,
	/\d+ matches/,
	/\d+ unsaved changes? waiting/,
	/Copy ID/,
	/Show fewer dates/,
	/View all \d+ dates/,
	/Posting-fulfillment evaluation is unavailable/,
	/Review scheduled transactions/,
	/adjust the horizon/,
	/Annualized spending interpreted/,
	/Grows annual spending/,
	/Accounts you are willing to draw from/,
	/Every month of spending must be funded/,
	/Updating runs the deterministic/,
	/None configured\. This plan/,
	/Choose only income that remains available/,
	/No unassigned income postings/,
	/Select an asset to see its related postings/,
	/Choose when the entered annual spending/,
	/An equivalent data table is available behind/,
];

function visibleText(root: HTMLElement): string {
	const parts: string[] = [];
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	let node = walker.nextNode();
	while (node) {
		const text = node.textContent?.trim();
		let el = node.parentElement;
		let hidden = false;
		while (el && el !== root) {
			if (el.classList.contains("sr-only")) {
				hidden = true;
				break;
			}
			el = el.parentElement;
		}
		if (text && !hidden) parts.push(text);
		node = walker.nextNode();
	}
	return parts.join("\n");
}

function renderRoute(path: string) {
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
						<ModelInputsPage />
					</RuntimeFixtureProviders>
				),
			},
			{
				path: "/results",
				element: (
					<RuntimeFixtureProviders
						model={{
							document,
							effectiveDocument: document,
							dataUpdatedAt: 1,
						}}
					>
						<ResultsPage />
					</RuntimeFixtureProviders>
				),
			},
			{
				path: "/analysis",
				element: (
					<RuntimeFixtureProviders
						model={{
							document,
							effectiveDocument: document,
							dataUpdatedAt: 1,
						}}
					>
						<AnalysisPage />
					</RuntimeFixtureProviders>
				),
			},
			{
				path: "/settings",
				element: (
					<RuntimeFixtureProviders
						model={{
							document,
							effectiveDocument: document,
							dataUpdatedAt: 1,
						}}
					>
						<SettingsPage />
					</RuntimeFixtureProviders>
				),
			},
		],
		{ initialEntries: [path] },
	);
	return render(<RouterProvider router={router} />);
}

afterEach(() => {
	cleanup();
	useStore.setState({ evaluations: structuredClone(DEFAULT_EVALUATIONS) });
});

describe("copy audit", () => {
	for (const path of ["/", "/results", "/analysis", "/settings"]) {
		it(`has no banned copy on ${path}`, () => {
			const { container } = renderRoute(path);
			const text = visibleText(container);
			const hits = BANNED.filter((pattern) => pattern.test(text));
			expect(
				hits.length === 0
					? text
					: `${path} banned copy ${hits.join(" ")}:\n${text}`,
			).toBe(text);
		});
	}
});
