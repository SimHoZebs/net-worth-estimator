// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type {
	EvaluationResultCollection,
	EvaluationTables,
} from "@/lib/projection";
import { DEFAULT_EVALUATIONS, useStore } from "@/store";
import { EvaluationList } from "./EvaluationList";

afterEach(() => {
	cleanup();
	useStore.setState({ evaluations: structuredClone(DEFAULT_EVALUATIONS) });
});

describe("EvaluationList", () => {
	it("applies a net-worth target once after editing", () => {
		render(<EvaluationList />);

		fireEvent.change(screen.getByLabelText("Target net worth"), {
			target: { value: "1250000" },
		});
		expect(
			useStore.getState().evaluations.netWorthThreshold[0]?.config.target,
		).toBe(1_000_000);

		fireEvent.click(screen.getByRole("button", { name: "Update analysis" }));
		expect(
			useStore.getState().evaluations.netWorthThreshold[0]?.config.target,
		).toBe(1_250_000);
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

		render(<EvaluationList />);

		const labels = screen
			.getAllByRole("textbox")
			.map((input) => (input as HTMLInputElement).value);
		expect(labels).toEqual(["First target", "Second target"]);
		expect(screen.getByText("first-target", { exact: false })).not.toBeNull();
		expect(screen.getByText("second-target", { exact: false })).not.toBeNull();
	});

	it("renders malformed config and runtime diagnostics without opening an editor", () => {
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
		const results: EvaluationResultCollection = {
			evaluations: {
				financialIndependence: [],
				netWorthThreshold: [
					{
						instanceId: "broken-target",
						label: "Broken target",
						status: "warning",
						deterministic: null,
						probabilistic: null,
						diagnostics: [
							{
								code: "invalid-evaluation-config",
								severity: "error",
								message: "Threshold config is invalid.",
							},
						],
					},
				],
				postingFulfillment: [],
			},
		};

		render(<EvaluationList results={results} />);

		expect(screen.getByLabelText("Enable Broken target")).not.toBeNull();
		expect(screen.getByLabelText("Label for broken-target")).not.toBeNull();
		expect(screen.queryByLabelText("Target net worth")).toBeNull();
		expect(screen.getAllByRole("alert")).toHaveLength(2);
	});
});
