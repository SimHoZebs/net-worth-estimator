import type uPlot from "uplot";
import { describe, expect, it } from "vitest";
import { createBaseOptions } from "@/chart/uplotBase";

describe("createBaseOptions", () => {
	it("uses the shared chart currency formatter for y-axis ticks", () => {
		const values = createBaseOptions().axes?.[1]?.values;
		expect(typeof values).toBe("function");

		const formatTicks = values as (self: uPlot, ticks: number[]) => string[];
		expect(formatTicks({} as uPlot, [-2_000_000, 0, 2_500, 1_000_000])).toEqual(
			["-$2M", "$0", "$2.5k", "$1M"],
		);
	});
});
