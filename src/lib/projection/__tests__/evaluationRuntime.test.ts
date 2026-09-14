import { describe, expect, it } from "vitest";
import { getNetWorthThresholdResult, isJsonValue } from "../index";
import type { EvaluationResultCollection } from "../types/model";

describe("evaluation registry and runtime", () => {
	it("rejects maps and functions at the JSON boundary", () => {
		expect(isJsonValue(new Map())).toBe(false);
		expect(isJsonValue({ callback: () => true })).toBe(false);
		const cyclic: Record<string, unknown> = {};
		cyclic.self = cyclic;
		expect(isJsonValue(cyclic)).toBe(false);
	});

	it("never exposes probabilistic data from a failed envelope", () => {
		const collection: EvaluationResultCollection = {
			evaluations: {
				financialIndependence: [],
				netWorthThreshold: [
					{
						instanceId: "failed",
						label: "Failed",
						status: "warning",
						deterministic: { reached: true, firstReachedDate: "2026-01-01" },
						probabilistic: {
							probability: 1,
							p10ReachedDate: "2026-01-01",
							medianReachedDate: "2026-01-01",
							p90ReachedDate: "2026-01-01",
						},
						diagnostics: [],
					},
				],
				postingFulfillment: [],
			},
		};
		expect(getNetWorthThresholdResult(collection)).toBeNull();
		expect(
			getNetWorthThresholdResult(collection, "failed")?.probabilistic,
		).toBeNull();
	});
});
