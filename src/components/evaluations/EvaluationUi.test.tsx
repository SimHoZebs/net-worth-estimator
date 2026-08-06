// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EvaluationTables } from "@/lib/projection";
import { DEFAULT_EVALUATIONS, useStore } from "@/store";
import { RuntimeFixtureProviders } from "@/test/runtimeFixtures";
import { EvaluationResults } from "./EvaluationResults";
import { EvaluationSettings } from "./EvaluationSettings";

vi.mock("@/components/dashboard/FinancialIndependenceChart", () => ({
	FinancialIndependenceChart: () => null,
}));

const emptyDocument = {
	accounts: [],
	postings: [],
	evaluations: structuredClone(DEFAULT_EVALUATIONS),
	source: { type: "csv", label: "Test" },
};

function renderSettings() {
	return render(
		<RuntimeFixtureProviders
			model={{
				document: emptyDocument as never,
				effectiveDocument: emptyDocument as never,
			}}
		>
			<EvaluationSettings onDraftDirtyChange={() => {}} />
		</RuntimeFixtureProviders>,
	);
}

afterEach(() => {
	cleanup();
	useStore.setState({ evaluations: structuredClone(DEFAULT_EVALUATIONS) });
});

describe("EvaluationSettings", () => {
	it("applies a net-worth target once after editing", () => {
		renderSettings();

		fireEvent.change(screen.getByLabelText("Target net worth"), {
			target: { value: "1250000" },
		});
		expect(
			useStore.getState().evaluations.netWorthThreshold[0]?.config.target,
		).toBe(1_000_000);

		const updateButton = screen
			.getAllByRole("button", { name: "Update analysis" })
			.find((button) => !(button as HTMLButtonElement).disabled);
		expect(updateButton).toBeDefined();
		fireEvent.click(updateButton!);
		expect(
			useStore.getState().evaluations.netWorthThreshold[0]?.config.target,
		).toBe(1_250_000);
	});

	it("keeps incomplete net-worth targets local until they are valid", () => {
		renderSettings();
		const target = screen.getByLabelText(
			"Target net worth",
		) as HTMLInputElement;
		const updateButton = screen
			.getAllByRole("button", { name: "Update analysis" })
			.find((button) => button.closest("div.space-y-2"));

		fireEvent.change(target, { target: { value: "-" } });
		expect(target.value).toBe("-");
		expect((updateButton as HTMLButtonElement).disabled).toBe(true);
		expect(
			useStore.getState().evaluations.netWorthThreshold[0]?.config.target,
		).toBe(1_000_000);

		fireEvent.change(target, { target: { value: "0x10" } });
		expect(target.value).toBe("0x10");
		expect((updateButton as HTMLButtonElement).disabled).toBe(true);

		fireEvent.change(target, { target: { value: "" } });
		expect(target.value).toBe("");
		fireEvent.click(screen.getByRole("button", { name: "Discard" }));
		expect(target.value).toBe("1000000");
	});

	it("renders duplicate evaluation instances in configured order", () => {
		useStore.setState({
			evaluations: {
				financialIndependence: [],
				netWorthThreshold: [
					{
						instanceId: "first-target",
						label: "First target",
						enabled: true,
						config: { target: 500_000 },
					},
					{
						instanceId: "second-target",
						label: "Second target",
						enabled: true,
						config: { target: 1_000_000 },
					},
				],
				postingFulfillment: [],
			},
		});

		renderSettings();

		const labels = [
			screen.getByLabelText("Label for first-target"),
			screen.getByLabelText("Label for second-target"),
		].map((input) => (input as HTMLInputElement).value);
		expect(labels).toEqual(["First target", "Second target"]);
		expect(screen.getByText("first-target", { exact: false })).not.toBeNull();
		expect(screen.getByText("second-target", { exact: false })).not.toBeNull();
	});

	it("renders malformed config without opening an editor", () => {
		useStore.setState({
			evaluations: {
				financialIndependence: [],
				netWorthThreshold: [
					{
						instanceId: "broken-target",
						label: "Broken target",
						enabled: true,
						config: null,
					},
				],
				postingFulfillment: [],
			} as unknown as EvaluationTables,
		});
		renderSettings();

		expect(screen.getByLabelText("Enable Broken target")).not.toBeNull();
		expect(screen.getByLabelText("Label for broken-target")).not.toBeNull();
		expect(screen.queryByLabelText("Target net worth")).toBeNull();
		expect(screen.getAllByRole("alert")).toHaveLength(1);
	});

	it("renders result cards without configuration controls", () => {
		useStore.setState({
			evaluations: {
				financialIndependence: [],
				netWorthThreshold: [
					{
						instanceId: "target",
						label: "Target outcome",
						enabled: false,
						config: { target: 1_000_000 },
					},
				],
				postingFulfillment: [],
			},
		});

		render(
			<EvaluationResults
				document={emptyDocument as never}
				result={
					{
						evaluations: {
							financialIndependence: [],
							netWorthThreshold: [],
							postingFulfillment: [],
						},
					} as never
				}
			/>,
		);

		expect(screen.getByText("Target outcome")).not.toBeNull();
		expect(screen.queryByLabelText("Enable Target outcome")).toBeNull();
		expect(screen.queryByLabelText("Label for target")).toBeNull();
		expect(screen.queryByLabelText("Target net worth")).toBeNull();
	});

	it("shows Monte Carlo workload progress inside its evaluation card", () => {
		render(
			<EvaluationResults
				document={emptyDocument as never}
				result={
					{
						evaluations: {
							financialIndependence: [],
							netWorthThreshold: [],
							postingFulfillment: [],
						},
					} as never
				}
				resultsAreStale
				stochasticIsRunning
				stochasticProgress={{
					phase: "stochastic-runs",
					completedRuns: 370,
					totalRuns: 1000,
					fraction: 0.37,
					evaluationWorkloads: [
						{
							type: "financialIndependence",
							instanceId: "financial-independence",
							label: "Financial independence",
							completedUnits: 10_000,
							totalUnits: 61_000,
							unitLabel: "monthly start dates",
							unitAction: "checked",
							intensiveUnitsCompleted: 1_246,
							intensiveUnitLabel: "candidate sustainability cycles",
							intensiveUnitAction: "attempted",
							description:
								"Failed cycles stop at the first shortfall; date checks stop after the first successful 10-year test.",
						},
					],
				}}
			/>,
		);

		const progress = screen.getByRole("progressbar", {
			name: "Financial independence Monte Carlo progress",
		});
		expect(progress.getAttribute("aria-valuenow")).toBe("37");
		const card = screen
			.getByText("Running FI Monte Carlo")
			.closest("[data-slot='card']");
		expect(card?.textContent).toContain(
			"Previous FI results are hidden until recalculation completes.",
		);
		expect(card?.textContent).toContain("10,000 monthly start dates checked");
		expect(card?.textContent).not.toContain("10,000 / 61,000");
		expect(card?.textContent).toContain(
			"1,246 candidate sustainability cycles attempted",
		);
		expect(card?.textContent).not.toContain("370 / 1,000 Monte Carlo paths");
		expect(card?.textContent).not.toContain("Updating FI outcomes");
		expect(card?.textContent).not.toContain("Failed cycles stop");
		expect(
			card?.querySelector("[data-slot='card-header']")?.textContent,
		).not.toContain("updating");
		expect(screen.queryByRole("status")).toBeNull();
	});

	it("identifies the deterministic FI result as current during Monte Carlo", () => {
		render(
			<EvaluationResults
				document={emptyDocument as never}
				result={
					{
						evaluations: {
							financialIndependence: [],
							netWorthThreshold: [],
							postingFulfillment: [],
						},
					} as never
				}
				stochasticIsRunning
				stochasticProgress={{
					phase: "stochastic-runs",
					completedRuns: 370,
					totalRuns: 1000,
					fraction: 0.37,
					evaluationWorkloads: [
						{
							type: "financialIndependence",
							instanceId: "financial-independence",
							label: "Financial independence",
							completedUnits: 22_570,
							totalUnits: 61_000,
							unitLabel: "monthly start dates",
							unitAction: "checked",
						},
					],
				}}
			/>,
		);

		expect(
			screen.getByText(
				"The deterministic FI result below is current. Monte Carlo confidence is still being calculated.",
			),
		).not.toBeNull();
		expect(screen.getByText("Running FI Monte Carlo")).not.toBeNull();
	});
});
