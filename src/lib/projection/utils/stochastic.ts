import type { PercentileBands } from "../types/stochastic";

class LCG {
	private state: number;

	constructor(seed: number) {
		this.state = seed;
	}

	next(): number {
		this.state = (this.state * 1664525 + 1013904223) & 0x7fffffff;
		return this.state / 0x7fffffff;
	}
}

let sharedLcg: LCG | null = null;

export function reseed(seed: number | null): void {
	if (seed === null) {
		sharedLcg = null;
		return;
	}

	sharedLcg = new LCG(seed);
}

function randomUniform(): number {
	if (sharedLcg !== null) {
		return sharedLcg.next();
	}

	return Math.random();
}

export function sampleLogNormal(
	expectedReturn: number,
	volatility: number,
): number {
	if (volatility <= 0) {
		return expectedReturn;
	}

	const u = randomUniform();
	const v = randomUniform();
	const standardNormal =
		Math.sqrt(-2 * Math.log(Math.max(u, 1e-10))) * Math.cos(2 * Math.PI * v);
	const sigma = volatility;
	const mu = Math.log(1 + expectedReturn) - (sigma * sigma) / 2;
	return Math.exp(mu + sigma * standardNormal) - 1;
}

export function mergeSorted(a: number[], b: number[]): number[] {
	const result: number[] = [];
	let i = 0;
	let j = 0;
	while (i < a.length && j < b.length) {
		if (a[i] <= b[j]) {
			result.push(a[i++]);
		} else {
			result.push(b[j++]);
		}
	}
	while (i < a.length) result.push(a[i++]);
	while (j < b.length) result.push(b[j++]);
	return result;
}

export function computePercentiles(values: number[]): PercentileBands {
	if (values.length === 0) {
		return { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
	}

	const sorted = [...values].sort((a, b) => a - b);
	return computePercentilesFromSorted(sorted);
}

export function computePercentilesFromSorted(
	sorted: number[],
): PercentileBands {
	if (sorted.length === 0) {
		return { p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 };
	}

	return {
		p10: quantile(sorted, 0.1),
		p25: quantile(sorted, 0.25),
		p50: quantile(sorted, 0.5),
		p75: quantile(sorted, 0.75),
		p90: quantile(sorted, 0.9),
	};
}

function quantile(sorted: number[], q: number): number {
	const pos = q * (sorted.length - 1);
	const lo = Math.floor(pos);
	const hi = Math.ceil(pos);

	if (lo === hi) {
		return sorted[lo];
	}

	const frac = pos - lo;
	return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}
