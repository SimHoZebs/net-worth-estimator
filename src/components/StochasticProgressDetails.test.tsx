// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StochasticProgressDetails } from "./StochasticProgressDetails";

afterEach(cleanup);

describe("StochasticProgressDetails", () => {
	it("suppresses obsolete FI implementation copy but keeps useful warnings", () => {
		const progress = {
			phase: "stochastic-runs" as const,
			completedRuns: 1,
			totalRuns: 10,
			fraction: 0.1,
			evaluationWorkloads: [
				{
					type: "financialIndependence" as const,
					instanceId: "fi",
					label: "Financial independence",
					completedUnits: 5,
					totalUnits: 50,
					unitLabel: "monthly start dates",
					unitAction: "checked",
					description:
						"Failed cycles stop at the first shortfall; date checks stop after the first successful 10-year test.",
				},
			],
		};

		const { rerender } = render(
			<StochasticProgressDetails progress={progress} />,
		);
		expect(
			screen.queryByText("Failed cycles stop", { exact: false }),
		).toBeNull();

		rerender(
			<StochasticProgressDetails
				progress={{
					...progress,
					evaluationWorkloads: [
						{
							...progress.evaluationWorkloads[0]!,
							description:
								"No complete 10-year FI test fits in this projection horizon.",
						},
					],
				}}
			/>,
		);
		expect(
			screen.getByText(
				"No complete 10-year FI test fits in this projection horizon.",
			),
		).not.toBeNull();
	});
});
