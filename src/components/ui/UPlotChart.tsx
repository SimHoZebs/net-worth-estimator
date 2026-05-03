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
            const ph = self.bbox.height;

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

    const ro = new ResizeObserver((entries) => {
      const { width: w, height: h } = entries[0].contentRect;
      if (w > 0 && h > 0) {
        chartRef.current?.setSize({ width: w, height: h });
      }
    });
    ro.observe(target);

    return () => {
      ro.disconnect();
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [options, tooltipContent]);

  useEffect(() => {
    chartRef.current?.setData(data);
  }, [data]);

  return (
    <div ref={targetRef} className="relative min-h-[420px] w-full">
      <div
        ref={tooltipRef}
        className="pointer-events-none absolute z-50 hidden"
      />
    </div>
  );
}
