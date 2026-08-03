import { describe, expect, it } from "vitest";
import { runAnalysis } from "./runtime";
import type { AnalysisDefinition } from "./types";

describe("analysis runtime", () => {
	it("preserves definition warnings as a successful value", async () => {
		const definition: AnalysisDefinition<number, number> = {
			id: "double",
			label: "Double",
			run: ({ input }) => ({
				value: input * 2,
				diagnostics: [
					{ code: "approximate", severity: "warning", message: "Approximate" },
				],
			}),
		};
		await expect(runAnalysis(definition, 4)).resolves.toMatchObject({
			state: "warning",
			value: 8,
		});
	});

	it("isolates unexpected definition failures", async () => {
		const definition: AnalysisDefinition<void, never> = {
			id: "broken",
			label: "Broken",
			run: () => {
				throw new Error("analysis exploded");
			},
		};
		await expect(runAnalysis(definition, undefined)).resolves.toMatchObject({
			state: "error",
			value: null,
			diagnostics: [{ message: "analysis exploded" }],
		});
	});

	it("treats definition error diagnostics as an error result", async () => {
		const definition: AnalysisDefinition<void, number> = {
			id: "invalid",
			label: "Invalid",
			run: () => ({
				value: 1,
				diagnostics: [
					{
						code: "invalid-input",
						severity: "error",
						message: "Invalid input",
					},
				],
			}),
		};
		await expect(runAnalysis(definition, undefined)).resolves.toMatchObject({
			state: "error",
			value: null,
		});
	});

	it("rethrows cancellation instead of reporting an analysis error", async () => {
		const controller = new AbortController();
		controller.abort();
		const definition: AnalysisDefinition<void, null> = {
			id: "cancelled",
			label: "Cancelled",
			run: () => ({ value: null, diagnostics: [] }),
		};
		await expect(
			runAnalysis(definition, undefined, controller.signal),
		).rejects.toMatchObject({ name: "AbortError" });
	});

	it("rethrows a later failure when the signal was aborted", async () => {
		const controller = new AbortController();
		const definition: AnalysisDefinition<void, null> = {
			id: "late-cancelled",
			label: "Late cancelled",
			run: async () => {
				controller.abort();
				throw new Error("late failure");
			},
		};
		await expect(
			runAnalysis(definition, undefined, controller.signal),
		).rejects.toMatchObject({ name: "AbortError" });
	});
});
