import type uPlot from "uplot";

function parseIsoDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function formatChartCurrencyTick(value: number): string {
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return `${sign}$${abs}`;
}

export function formatDate(isoDate: string): string {
  if (!isoDate || isoDate.length < 10) return isoDate;
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function createBaseOptions(): Partial<uPlot.Options> {
  return {
    ms: 1,
    mode: 1,
    scales: {
      x: { time: true },
    },
    axes: [
      {
        scale: "x",
        side: 2,
        stroke: "#334155",
        font: "12px system-ui, sans-serif",
        grid: { stroke: "#e2e8f0", width: 1 },
        ticks: { stroke: "#e2e8f0", width: 1, size: 6 },
        gap: 4,
        values: "{MMM} '{YY}",
      },
      {
        scale: "y",
        side: 3,
        stroke: "#334155",
        font: "12px system-ui, sans-serif",
        size: 72,
        grid: { stroke: "#e2e8f0", width: 1 },
        ticks: { stroke: "#e2e8f0", width: 1, size: 6 },
        gap: 4,
        values: (_self: uPlot, ticks: number[]) => ticks.map((v) => formatChartCurrencyTick(v)),
      },
    ],
    cursor: {
      show: true,
      x: true,
      y: false,
      drag: { x: false, y: false },
    },
  };
}

export function createReferenceLinesHooks(
  targetNetWorth: number,
  milestoneDates?: { hitTarget?: string; firstShortfall?: string },
): uPlot.Hooks.Arrays {
  return {
    draw: [
      (self: uPlot) => {
        try {
          if (targetNetWorth <= 0) return;
          const { ctx, bbox } = self;
          ctx.save();

          const y = self.valToPos(targetNetWorth, "y");
          ctx.strokeStyle = "#334155";
          ctx.lineWidth = 2;
          ctx.setLineDash([5, 5]);
          ctx.beginPath();
          ctx.moveTo(bbox.left, y);
          ctx.lineTo(bbox.left + bbox.width, y);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.fillStyle = "#334155";
          ctx.font = "600 12px system-ui, sans-serif";
          ctx.textAlign = "right";
          ctx.textBaseline = "bottom";
          ctx.fillText(
            `Target: ${formatChartCurrencyTick(targetNetWorth)}`,
            bbox.left + bbox.width - 4,
            y - 4,
          );

          for (const ms of [milestoneDates?.hitTarget, milestoneDates?.firstShortfall]) {
            if (!ms) continue;
            const ts = parseIsoDate(ms).getTime();
            const x = self.valToPos(ts, "x");
            if (x < bbox.left || x > bbox.left + bbox.width) continue;

            const isHit = ms === milestoneDates?.hitTarget;
            ctx.strokeStyle = isHit ? "#059669" : "#d97706";
            ctx.lineWidth = 1.5;
            ctx.setLineDash([4, 4]);
            ctx.beginPath();
            ctx.moveTo(x, bbox.top);
            ctx.lineTo(x, bbox.top + bbox.height);
            ctx.stroke();
            ctx.setLineDash([]);

            ctx.fillStyle = isHit ? "#059669" : "#d97706";
            ctx.font = "500 11px system-ui, sans-serif";
            ctx.textAlign = "left";
            if (isHit) {
              ctx.textBaseline = "top";
              ctx.fillText("Target reached", x + 4, bbox.top + 4);
            } else {
              ctx.textBaseline = "bottom";
              ctx.fillText("First shortfall", x + 4, bbox.top + bbox.height - 4);
            }
          }

          ctx.restore();
        } catch {
          // hook errors must not break chart rendering
        }
      },
    ],
  };
}
