import type uPlot from "uplot";

export function canTweenAlignedData(
	from: uPlot.AlignedData,
	to: uPlot.AlignedData,
	seriesIndexes: readonly number[],
): boolean {
	if (
		seriesIndexes.length === 0 ||
		from.length !== to.length ||
		from.some((series, index) => series.length !== to[index]?.length)
	) {
		return false;
	}

	const timestamps = from[0];
	if (timestamps.some((timestamp, index) => timestamp !== to[0][index])) {
		return false;
	}

	const uniqueIndexes = new Set(seriesIndexes);
	if (
		uniqueIndexes.size !== seriesIndexes.length ||
		seriesIndexes.some((index) => index <= 0 || index >= from.length)
	) {
		return false;
	}

	for (const seriesIndex of seriesIndexes) {
		for (
			let valueIndex = 0;
			valueIndex < from[seriesIndex].length;
			valueIndex++
		) {
			const fromValue = from[seriesIndex][valueIndex];
			const toValue = to[seriesIndex][valueIndex];
			if (
				typeof fromValue !== "number" ||
				!Number.isFinite(fromValue) ||
				typeof toValue !== "number" ||
				!Number.isFinite(toValue)
			) {
				return false;
			}
		}
	}
	return true;
}

export function hasTweenableChange(
	from: uPlot.AlignedData,
	to: uPlot.AlignedData,
	seriesIndexes: readonly number[],
): boolean {
	for (const seriesIndex of seriesIndexes) {
		for (
			let valueIndex = 0;
			valueIndex < from[seriesIndex].length;
			valueIndex++
		) {
			if (from[seriesIndex][valueIndex] !== to[seriesIndex][valueIndex]) {
				return true;
			}
		}
	}
	return false;
}

export function interpolateAlignedData(
	from: uPlot.AlignedData,
	to: uPlot.AlignedData,
	seriesIndexes: readonly number[],
	progress: number,
): uPlot.AlignedData {
	const frame = to.slice() as uPlot.AlignedData;
	for (const seriesIndex of seriesIndexes) {
		frame[seriesIndex] = to[seriesIndex].map((target, valueIndex) => {
			const start = from[seriesIndex][valueIndex] as number;
			return start + ((target as number) - start) * progress;
		});
	}
	return frame;
}

export function easeOutCubic(progress: number): number {
	return 1 - (1 - progress) ** 3;
}
