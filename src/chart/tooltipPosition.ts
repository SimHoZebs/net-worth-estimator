interface TooltipPositionInput {
	cursorLeft: number;
	cursorTop: number;
	tooltipWidth: number;
	tooltipHeight: number;
	containerWidth: number;
	containerHeight: number;
}

export function calculateTooltipPosition({
	cursorLeft,
	cursorTop,
	tooltipWidth,
	tooltipHeight,
	containerWidth,
	containerHeight,
}: TooltipPositionInput): { left: number; top: number } {
	const gap = 12;
	const padding = 4;
	const maxLeft = Math.max(padding, containerWidth - tooltipWidth - padding);
	const maxTop = Math.max(padding, containerHeight - tooltipHeight - padding);

	const right = cursorLeft + gap;
	const left = cursorLeft - tooltipWidth - gap;
	const above = cursorTop - tooltipHeight - gap;
	const below = cursorTop + gap;

	return {
		left: Math.min(
			Math.max(
				right + tooltipWidth <= containerWidth - padding ? right : left,
				padding,
			),
			maxLeft,
		),
		top: Math.min(
			Math.max(
				above >= padding
					? above
					: below + tooltipHeight <= containerHeight - padding
						? below
						: maxTop,
				padding,
			),
			maxTop,
		),
	};
}
