import type uPlot from "uplot";
import type {
  ProjectionResult,
  ScenarioPack,
  StochasticProjectionResult,
} from "@/lib/projection";


function parseIsoDate(date: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export interface UplotDataMeta {
  enabledAccounts: { id: string; label: string; color: string | null }[];
  hasStochasticData: boolean;
}

export function buildUplotDiagnosticData(
  pack: ScenarioPack,
  result: ProjectionResult,
  stochasticResult?: StochasticProjectionResult | null,
): { data: number[][]; meta: UplotDataMeta } {
  const enabledAccounts = pack.accounts.filter((a) => a.enabled);
  const hasStochastic = stochasticResult != null && stochasticResult.bands.length > 0;
  const bandByDate = hasStochastic
    ? new Map(stochasticResult!.bands.map((b) => [b.date, b]))
    : null;

  const tsList: number[] = [];
  const p10List: number[] = [];
  const p90List: number[] = [];
  const p25List: number[] = [];
  const p75List: number[] = [];
  const p50List: number[] = [];
  const nwList: number[] = [];
  const accountLists: number[][] = enabledAccounts.map(() => []);

  for (const row of result.timeline.sampledRows) {
    const d = parseIsoDate(row.date);
    tsList.push(d.getTime());

    let p10: number, p90: number, p25: number, p75: number, p50: number;

    if (bandByDate) {
      const band = bandByDate.get(row.date);
      if (band) {
        p10 = band.netWorth.p10;
        p90 = band.netWorth.p90;
        p25 = band.netWorth.p25;
        p75 = band.netWorth.p75;
        p50 = band.netWorth.p50;
      } else {
        p50 = row.netWorth;
        p10 = p50; p90 = p50; p25 = p50; p75 = p50;
      }
    } else {
      p50 = row.netWorth;
      p10 = p50; p90 = p50; p25 = p50; p75 = p50;
    }

    p10List.push(p10);
    p90List.push(p90);
    p25List.push(p25);
    p75List.push(p75);
    p50List.push(p50);
    nwList.push(row.netWorth);

    for (let i = 0; i < enabledAccounts.length; i++) {
      accountLists[i].push(row.accountBalances[enabledAccounts[i].id] ?? 0);
    }
  }

  return {
    data: [tsList, p10List, p90List, p25List, p75List, p50List, nwList, ...accountLists],
    meta: { enabledAccounts, hasStochasticData: hasStochastic },
  };
}

export function buildUplotDiagnosticOptions(
  targetNetWorth: number,
  hasStochasticData: boolean,
  milestoneDates: { hitTarget?: string; firstShortfall?: string },
  viewMode: "net-worth" | "accounts",
  enabledAccounts: { id: string; label: string; color: string | null }[],
): uPlot.Options {
  const showMainNw = !hasStochasticData;
  const showP50 = hasStochasticData;

  const series: uPlot.Series[] = [
    {},
    {
      show: hasStochasticData,
      stroke: "rgba(0,0,0,0.01)",
      width: 0.5,
      points: { show: false },
    },
    {
      show: hasStochasticData,
      stroke: "rgba(0,0,0,0.01)",
      width: 0.5,
      points: { show: false },
    },
    {
      show: hasStochasticData,
      stroke: "rgba(0,0,0,0.01)",
      width: 0.5,
      points: { show: false },
    },
    {
      show: hasStochasticData,
      stroke: "rgba(0,0,0,0.01)",
      width: 0.5,
      points: { show: false },
    },
    {
      label: showP50 ? "Net worth (median simulation)" : undefined,
      show: showP50,
      stroke: "#0f172a",
      width: 2.5,
      points: { show: false },
    },
    {
      label: showMainNw ? "Net worth" : undefined,
      show: showMainNw,
      stroke: "#0f172a",
      width: 2.5,
      points: { show: false },
    },
    ...enabledAccounts.map((a) => ({
      label: viewMode === "accounts" ? a.label : undefined,
      show: viewMode === "accounts",
      stroke: a.color ?? "#334155",
      width: 2,
      points: { show: false },
    })),
  ];

  return {
    mode: 1,
    ms: 1,
    width: 600,
    height: 420,
    series,
    bands: hasStochasticData
      ? [
          {
            series: [1, 2],
            fill: "rgba(15,23,42,0.08)",
            dir: 1,
          },
          {
            series: [3, 4],
            fill: "rgba(15,23,42,0.15)",
            dir: 1,
          },
        ]
      : [],
    scales: {
      x: { time: true },
      y: {
        range: (_self, min, max) => {
          const lower = Math.min(0, min);
          const upper = Math.max(targetNetWorth * 2, max * 1.1);
          return [lower, upper];
        },
      },
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
        values: (_self, ticks) => ticks.map((v) => formatChartCurrencyTick(v)),
      },
    ],
    legend: { show: false },
    cursor: {
      show: true,
      x: true,
      y: false,
      drag: { x: false, y: false },
    },
    hooks: {
      draw: [
        (self) => {
          try {
            const { ctx, bbox } = self;
            ctx.save();

            if (targetNetWorth > 0) {
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
            }

            for (const ms of [milestoneDates.hitTarget, milestoneDates.firstShortfall]) {
              if (!ms) continue;
              const ts = parseIsoDate(ms).getTime();
              const x = self.valToPos(ts, "x");
              if (x < bbox.left || x > bbox.left + bbox.width) continue;

              const isHit = ms === milestoneDates.hitTarget;
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
    },
  };
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
