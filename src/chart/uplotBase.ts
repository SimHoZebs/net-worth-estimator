import type uPlot from "uplot";
import { formatChartCurrencyTick } from "@/lib/format";

function parseIsoDate(date: string): Date {
	const [year, month, day] = date.split("-").map(Number);
	return new Date(year, month - 1, day);
}

function cssColor(variableName: string, fallback: string): string {
	if (typeof window === "undefined") return fallback;
	const value = window
		.getComputedStyle(document.documentElement)
		.getPropertyValue(variableName)
		.trim();
	return value || fallback;
}

export function createBaseOptions(): Partial<uPlot.Options> {
	const axisColor = cssColor("--chart-axis", "#334155");
	const gridColor = cssColor("--chart-grid", "#e2e8f0");

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
				stroke: axisColor,
				font: "12px system-ui, sans-serif",
				grid: { stroke: gridColor, width: 1 },
				ticks: { stroke: gridColor, width: 1, size: 6 },
				gap: 4,
				values: "{MMM} '{YY}",
			},
			{
				scale: "y",
				side: 3,
				stroke: axisColor,
				font: "12px system-ui, sans-serif",
				size: 72,
				grid: { stroke: gridColor, width: 1 },
				ticks: { stroke: gridColor, width: 1, size: 6 },
				gap: 4,
				values: (_self: uPlot, ticks: number[]) =>
					ticks.map((v) => formatChartCurrencyTick(v)),
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

type ReferenceMilestones = { hitTarget?: string; firstShortfall?: string };

export function createReferenceLinesHooks(
	milestoneDates?: ReferenceMilestones,
): uPlot.Hooks.Arrays {
	const warningColor = cssColor("--chart-warning", "#d97706");

	return {
		draw: [
			(self: uPlot) => {
				try {
					const { ctx, bbox } = self;
					ctx.save();

					for (const ms of [milestoneDates?.firstShortfall]) {
						if (!ms) continue;
						const ts = parseIsoDate(ms).getTime();
						const x = self.valToPos(ts, "x");
						if (x < bbox.left || x > bbox.left + bbox.width) continue;

						ctx.strokeStyle = warningColor;
						ctx.lineWidth = 1.5;
						ctx.setLineDash([4, 4]);
						ctx.beginPath();
						ctx.moveTo(x, bbox.top);
						ctx.lineTo(x, bbox.top + bbox.height);
						ctx.stroke();
						ctx.setLineDash([]);

						ctx.fillStyle = warningColor;
						ctx.font = "500 11px system-ui, sans-serif";
						ctx.textAlign = "left";
						ctx.textBaseline = "bottom";
						ctx.fillText("First shortfall", x + 4, bbox.top + bbox.height - 4);
					}

					ctx.restore();
				} catch {
					// hook errors must not break chart rendering
				}
			},
		],
	};
}
