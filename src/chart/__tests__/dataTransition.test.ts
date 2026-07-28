import type uPlot from "uplot";
import { describe, expect, it } from "vitest";
import {
	canTweenAlignedData,
	easeOutCubic,
	hasTweenableChange,
	interpolateAlignedData,
} from "../dataTransition";

const from = [
	[1, 2],
	[10, 20],
	[30, 40],
] as uPlot.AlignedData;
const to = [
	[1, 2],
	[20, 40],
	[50, 60],
] as uPlot.AlignedData;

describe("aligned chart data transitions", () => {
	it("accepts compatible finite series and detects changes", () => {
		expect(canTweenAlignedData(from, to, [1, 2])).toBe(true);
		expect(hasTweenableChange(from, to, [1, 2])).toBe(true);
	});

	it("rejects timestamp, shape, index, and numeric incompatibilities", () => {
		expect(
			canTweenAlignedData(
				from,
				[
					[1, 3],
					[20, 40],
					[50, 60],
				],
				[1],
			),
		).toBe(false);
		expect(canTweenAlignedData(from, [[1, 2], [20], [50, 60]], [1])).toBe(
			false,
		);
		expect(canTweenAlignedData(from, to, [0])).toBe(false);
		expect(canTweenAlignedData(from, to, [1, 1])).toBe(false);
		expect(
			canTweenAlignedData(
				from,
				[
					[1, 2],
					[Number.NaN, 40],
					[50, 60],
				],
				[1],
			),
		).toBe(false);
	});

	it("allocates only tweened series and preserves its inputs", () => {
		const frame = interpolateAlignedData(from, to, [1], 0.5);

		expect(frame).toEqual([
			[1, 2],
			[15, 30],
			[50, 60],
		]);
		expect(frame[0]).toBe(to[0]);
		expect(frame[2]).toBe(to[2]);
		expect(from[1]).toEqual([10, 20]);
		expect(to[1]).toEqual([20, 40]);
	});

	it("uses cubic ease-out progression", () => {
		expect(easeOutCubic(0)).toBe(0);
		expect(easeOutCubic(0.5)).toBe(0.875);
		expect(easeOutCubic(1)).toBe(1);
	});
});
