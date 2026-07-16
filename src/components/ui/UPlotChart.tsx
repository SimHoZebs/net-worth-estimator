import { type ReactNode, useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface UPlotChartProps {
	options: uPlot.Options;
	data: uPlot.AlignedData;
	tooltipContent?: (self: uPlot, idx: number) => string;
	tooltip?: ReactNode;
	onCursorChange?: (idx: number | null) => void;
	desktopTooltipOnly?: boolean;
	className?: string;
}

export function UPlotChart({
	options,
	data,
	tooltipContent,
	tooltip,
	onCursorChange,
	desktopTooltipOnly = false,
	className = "h-[320px] md:h-[420px]",
}: UPlotChartProps) {
	const targetRef = useRef<HTMLDivElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<uPlot | null>(null);
	const lastWidthRef = useRef(0);
	const lastHeightRef = useRef(0);
	const tooltipContentRef = useRef(tooltipContent);
	const onCursorChangeRef = useRef(onCursorChange);
	const hasReactTooltipRef = useRef(tooltip != null);
	tooltipContentRef.current = tooltipContent;
	onCursorChangeRef.current = onCursorChange;
	hasReactTooltipRef.current = tooltip != null;

	useEffect(() => {
		const target = targetRef.current;
		if (!target) return;

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

						const cLeft = self.cursor.left ?? 0;
						const cTop = self.cursor.top ?? 0;
						const tw = tooltip.offsetWidth;
						const th = tooltip.offsetHeight;
						const pw = self.bbox.width;
						const _ph = self.bbox.height;

						let left = cLeft + 12;
						let top = cTop - th - 8;
						if (left + tw > pw - 4) left = pw - tw - 4;
						if (top < 0) top = cTop + 12;
						tooltip.style.left = `${left}px`;
						tooltip.style.top = `${top}px`;
					},
				],
			},
		};

		chartRef.current = new uPlot(opts, data, target);
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
			ro.disconnect();
			chartRef.current?.destroy();
			chartRef.current = null;
		};
	}, [options, data, desktopTooltipOnly]);

	useEffect(() => {
		chartRef.current?.setData(data);
	}, [data]);

	return (
		<div className="w-full min-w-0">
			<div
				ref={targetRef}
				className={`relative w-full min-w-0 overflow-hidden ${className}`}
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
