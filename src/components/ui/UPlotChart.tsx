import { useEffect, useRef } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";

interface UPlotChartProps {
	options: uPlot.Options;
	data: uPlot.AlignedData;
	tooltipContent?: (self: uPlot, idx: number) => string;
}

export function UPlotChart({ options, data, tooltipContent }: UPlotChartProps) {
	const targetRef = useRef<HTMLDivElement>(null);
	const tooltipRef = useRef<HTMLDivElement>(null);
	const chartRef = useRef<uPlot | null>(null);
	const lastWidthRef = useRef(0);

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
						if (idx == null) {
							tooltip.style.display = "none";
							return;
						}
						if (!tooltipContent) return;
						tooltip.style.display = "block";
						tooltip.innerHTML = tooltipContent(self, idx);

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

		const ro = new ResizeObserver((entries) => {
			const cw = entries[0].contentRect.width;
			const w = Math.round(cw);
			if (w <= 0 || !chartRef.current) return;
			if (w === lastWidthRef.current) return;
			lastWidthRef.current = w;
			chartRef.current.setSize({ width: w, height: chartRef.current.height });
		});
		ro.observe(target);

		return () => {
			ro.disconnect();
			chartRef.current?.destroy();
			chartRef.current = null;
		};
	}, [options, tooltipContent, data]);

	useEffect(() => {
		chartRef.current?.setData(data);
	}, [data]);

	return (
		<div
			ref={targetRef}
			className="relative min-h-[420px] w-full overflow-hidden"
		>
			<div
				ref={tooltipRef}
				className="pointer-events-none absolute z-50 hidden"
			/>
		</div>
	);
}
