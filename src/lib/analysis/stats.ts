import type { EvidenceStrength } from "./evidence";

export function median(values: readonly number[]): number {
	const sorted = [...values].sort((left, right) => left - right);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
		: (sorted[middle] ?? 0);
}

export function quantile(
	values: readonly number[],
	percentile: number,
): number {
	const sorted = [...values].sort((left, right) => left - right);
	if (sorted.length === 0) return 0;
	const index = (sorted.length - 1) * percentile;
	const lower = Math.floor(index);
	const fraction = index - lower;
	return (
		(sorted[lower] ?? 0) +
		fraction *
			((sorted[Math.min(lower + 1, sorted.length - 1)] ?? 0) -
				(sorted[lower] ?? 0))
	);
}

export function dayDifference(left: string, right: string): number {
	return (
		(Date.parse(`${right}T00:00:00Z`) - Date.parse(`${left}T00:00:00Z`)) /
		86_400_000
	);
}

export function strengthRank(strength: EvidenceStrength): number {
	return strength === "strong" ? 3 : strength === "moderate" ? 2 : 1;
}
