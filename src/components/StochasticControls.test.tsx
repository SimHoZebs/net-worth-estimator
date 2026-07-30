// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useStore } from "@/store";
import {
	createStochasticProgressFixture,
	RuntimeFixtureProviders,
} from "@/test/runtimeFixtures";
import { StochasticControls } from "./StochasticControls";

const initialPreference = useStore.getState().stochasticPreference;
const initialConfig = useStore.getState().stochasticConfig;

beforeEach(() => {
	useStore.setState({
		stochasticPreference: "enabled",
		stochasticConfig: { runCount: 1000, seed: 42 },
	});
});

afterEach(() => {
	cleanup();
	useStore.setState({
		stochasticPreference: initialPreference,
		stochasticConfig: initialConfig,
	});
});

describe("StochasticControls", () => {
	it("shows path and evaluator workload while Monte Carlo is running", () => {
		render(
			<RuntimeFixtureProviders
				execution={{ isStochasticRunning: true }}
				capabilities={{ hasStochasticAccounts: true }}
				stochasticProgress={createStochasticProgressFixture({
					completedRuns: 125,
					fraction: 0.125,
					evaluationWorkloads: [
						{
							type: "financialIndependence",
							instanceId: "fi",
							label: "Financial independence",
							completedUnits: 7_625,
							totalUnits: 61_000,
							unitLabel: "monthly start dates",
							unitAction: "checked",
							intensiveUnitsCompleted: 400,
							intensiveUnitLabel: "candidate sustainability cycles",
							intensiveUnitAction: "attempted",
						},
					],
				})}
			>
				<StochasticControls />
			</RuntimeFixtureProviders>,
		);

		expect(screen.getByText("125 / 1,000 Monte Carlo paths")).not.toBeNull();
		expect(
			screen.getByText("7,625 / 61,000 monthly start dates checked"),
		).not.toBeNull();
		expect(
			screen.getByText("400 candidate sustainability cycles attempted"),
		).not.toBeNull();
	});
});
