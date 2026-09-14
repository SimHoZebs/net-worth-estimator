import { describe, expect, it } from "vitest";
import { throwIfAborted, toAnalysisResult } from "./runtime";

describe("analysis runtime", () => {
	it("reports a ready result without diagnostics", () => {
		expect(toAnalysisResult({ value: 8, diagnostics: [] })).toMatchObject({
			state: "ready",
			value: 8,
		});
	});

	it("preserves warnings as a successful value", () => {
		expect(
			toAnalysisResult({
				value: 8,
				diagnostics: [
					{ code: "approximate", severity: "warning", message: "Approximate" },
				],
			}),
		).toMatchObject({
			state: "warning",
			value: 8,
		});
	});

	it("treats error diagnostics as an error result", () => {
		expect(
			toAnalysisResult({
				value: 1,
				diagnostics: [
					{
						code: "invalid-input",
						severity: "error",
						message: "Invalid input",
					},
				],
			}),
		).toMatchObject({
			state: "error",
			value: null,
		});
	});

	it("throws when the signal was aborted", () => {
		const controller = new AbortController();
		controller.abort();
		try {
			throwIfAborted(controller.signal);
			expect.unreachable();
		} catch (error) {
			expect(error).toMatchObject({ name: "AbortError" });
		}
	});

	it("does nothing when the signal is live", () => {
		const controller = new AbortController();
		expect(() => throwIfAborted(controller.signal)).not.toThrow();
		expect(() => throwIfAborted()).not.toThrow();
	});
});
