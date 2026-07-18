// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { EvaluationResultCollection } from "@/lib/projection";
import { DEFAULT_EVALUATIONS, useStore } from "@/store";
import { EvaluationList } from "./EvaluationList";

afterEach(() => {
	cleanup();
	useStore.setState({ evaluations: structuredClone(DEFAULT_EVALUATIONS) });
});

describe("EvaluationList", () => {
	it("renders duplicate evaluation instances in configured order", () => {
		useStore.setState({
			evaluations: [
				{
					definitionId: "net-worth-threshold",
					instanceId: "first-target",
					label: "First target",
					enabled: true,
					config: { target: 500_000 },
				},
				{
					definitionId: "net-worth-threshold",
					instanceId: "second-target",
					label: "Second target",
					enabled: true,
					config: { target: 1_000_000 },
				},
			],
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
			evaluations: [
				{
					definitionId: "net-worth-threshold",
					instanceId: "broken-target",
					label: "Broken target",
					enabled: true,
					config: null,
				},
			],
		});
		const results: EvaluationResultCollection = {
			evaluationOrder: ["broken-target"],
			evaluations: {
				"broken-target": {
					definitionId: "net-worth-threshold",
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
			},
		};

		render(<EvaluationList results={results} />);

		expect(screen.getByLabelText("Enable Broken target")).not.toBeNull();
		expect(screen.getByLabelText("Label for broken-target")).not.toBeNull();
		expect(screen.queryByLabelText("Target net worth")).toBeNull();
		expect(screen.getAllByRole("alert")).toHaveLength(2);
	});
});
