import {
	type ReactNode,
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
} from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import {
	canTweenAlignedData,
	easeOutCubic,
	hasTweenableChange,
	interpolateAlignedData,
} from "@/chart/dataTransition";
import { calculateTooltipPosition } from "@/chart/tooltipPosition";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface UPlotDataTransition {
	seriesIndexes: readonly number[];
	durationMs?: number;
}

interface UPlotChartProps {
	options: uPlot.Options;
	data: uPlot.AlignedData;
	tooltipContent?: (self: uPlot, idx: number) => string;
	tooltip?: ReactNode;
	onCursorChange?: (idx: number | null) => void;
	desktopTooltipOnly?: boolean;
	dataTransition?: UPlotDataTransition;
}

export function UPlotChart({
	options,
	data,
	tooltipContent,
	tooltip,
	onCursorChange,
	desktopTooltipOnly = false,
	dataTransition,
}: UPlotChartProps) {
	const targetRef = useRef<HTMLDivElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<uPlot | null>(null);
	const lastWidthRef = useRef(0);
	const lastHeightRef = useRef(0);
	const tooltipContentRef = useRef(tooltipContent);
	const onCursorChangeRef = useRef(onCursorChange);
	const hasReactTooltipRef = useRef(tooltip != null);
	const dataRef = useRef(data);
	const dataTransitionRef = useRef(dataTransition);
	const animationFrameRef = useRef<number | null>(null);
	const prefersReducedMotion = usePrefersReducedMotion();
	dataRef.current = data;
	dataTransitionRef.current = dataTransition;
	tooltipContentRef.current = tooltipContent;
	onCursorChangeRef.current = onCursorChange;
	hasReactTooltipRef.current = tooltip != null;
	const transitionKey = dataTransition
		? `${dataTransition.durationMs ?? 200}:${dataTransition.seriesIndexes.join(",")}`
		: "";

	const cancelTransition = useCallback(() => {
		if (animationFrameRef.current == null) return;
		cancelAnimationFrame(animationFrameRef.current);
		animationFrameRef.current = null;
	}, []);

	const positionTooltip = useCallback((chart: uPlot) => {
		const target = targetRef.current;
		const tooltipElement = tooltipRef.current;
		if (!target || !tooltipElement) return;
		const { left, top } = calculateTooltipPosition({
			cursorLeft: chart.cursor.left ?? 0,
			cursorTop: chart.cursor.top ?? 0,
			tooltipWidth: tooltipElement.offsetWidth,
			tooltipHeight: tooltipElement.offsetHeight,
			containerWidth: target.clientWidth,
			containerHeight: target.clientHeight,
		});
		tooltipElement.style.left = `${left}px`;
		tooltipElement.style.top = `${top}px`;
	}, []);

	useEffect(() => {
		const target = targetRef.current;
		if (!target) return;

		cancelTransition();
		chartRef.current?.destroy();

		const rect = target.getBoundingClientRect();
		const width = rect.width || 600;
		const height = rect.height || 420;

		const opts: uPlot.Options = {
			...options,
			width,
			height,
			hooks: {
				...options.hooks,
				setCursor: [
					...(options.hooks?.setCursor ?? []),
					(self: uPlot) => {
						const tooltip = tooltipRef.current;
						if (!tooltip) return;
						const idx = self.cursor.idx;
						onCursorChangeRef.current?.(idx ?? null);
						if (idx == null) {
							tooltip.style.display = "none";
							return;
						}
						if (desktopTooltipOnly && window.innerWidth < 768) {
							tooltip.style.display = "none";
							return;
						}
						if (
							!tooltipContentRef.current &&
							!hasReactTooltipRef.current &&
							!onCursorChangeRef.current
						)
							return;
						tooltip.style.display = "block";
						if (tooltipContentRef.current) {
							tooltip.innerHTML = tooltipContentRef.current(self, idx);
						}

						positionTooltip(self);
					},
				],
			},
		};

		chartRef.current = new uPlot(opts, dataRef.current, target);
		lastWidthRef.current = Math.round(width);
		lastHeightRef.current = Math.round(height);

		const ro = new ResizeObserver((entries) => {
			const cw = entries[0].contentRect.width;
			const ch = entries[0].contentRect.height;
			const w = Math.round(cw);
			const h = Math.round(ch);
			if (w <= 0 || !chartRef.current) return;
			if (w === lastWidthRef.current && h === lastHeightRef.current) return;
			lastWidthRef.current = w;
			lastHeightRef.current = h;
			chartRef.current.setSize({ width: w, height: h });
		});
		ro.observe(target);

		return () => {
			cancelTransition();
			ro.disconnect();
			chartRef.current?.destroy();
			chartRef.current = null;
		};
	}, [options, desktopTooltipOnly, positionTooltip, cancelTransition]);

	useLayoutEffect(() => {
		const chart = chartRef.current;
		if (tooltip != null && chart?.cursor.idx != null) positionTooltip(chart);
	}, [tooltip, positionTooltip]);

	useEffect(() => {
		const chart = chartRef.current;
		if (!chart) return;

		cancelTransition();
		const targetData = data;
		const transition = transitionKey ? dataTransitionRef.current : undefined;
		if (
			prefersReducedMotion ||
			!transition ||
			!canTweenAlignedData(chart.data, targetData, transition.seriesIndexes)
		) {
			chart.setData(targetData);
			return;
		}

		if (!hasTweenableChange(chart.data, targetData, transition.seriesIndexes)) {
			if (chart.data !== targetData) chart.setData(targetData);
			return;
		}

		const startData = chart.data;
		const startedAt = performance.now();
		const durationMs = Math.max(1, transition.durationMs ?? 200);
		const renderFrame = (timestamp: number) => {
			if (chartRef.current !== chart) return;
			const progress = Math.min(1, (timestamp - startedAt) / durationMs);
			if (progress >= 1) {
				animationFrameRef.current = null;
				chart.setData(targetData);
				return;
			}
			chart.setData(
				interpolateAlignedData(
					startData,
					targetData,
					transition.seriesIndexes,
					easeOutCubic(Math.max(0, progress)),
				),
			);
			animationFrameRef.current = requestAnimationFrame(renderFrame);
		};
		animationFrameRef.current = requestAnimationFrame(renderFrame);
	}, [data, transitionKey, prefersReducedMotion, cancelTransition]);

	return (
		<div className="w-full min-w-0 overflow-x-auto overscroll-x-contain">
			<div
				ref={targetRef}
				className="relative min-h-[420px] w-full min-w-[700px] overflow-hidden md:min-w-0"
			>
				<div
					ref={tooltipRef}
					className="pointer-events-none absolute z-50 hidden"
				>
					{tooltip}
				</div>
			</div>
		</div>
	);
}
