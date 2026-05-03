import { memo, useCallback, useMemo } from "react";
import type uPlot from "uplot";
import type { ScenarioPack } from "@/lib/projection";
import { currency } from "@/lib/format";
import { UPlotChart } from "@/components/ui/UPlotChart";
import { createBaseOptions, createReferenceLinesHooks, formatDate } from "@/chart/uplotBase";

interface StackedContributionChartProps {
  pack: ScenarioPack;
  targetNetWorth: number;
  hasStochasticData: boolean;
  chartData: Record<string, string | number>[];
  milestoneDates?: { hitTarget?: string; firstShortfall?: string };
}

export const StackedContributionChart = memo(function StackedContributionChart({
  pack,
  targetNetWorth,
  hasStochasticData,
  chartData,
  milestoneDates,
}: StackedContributionChartProps) {
  const enabledAccounts = useMemo(
    () => pack.accounts.filter((a) => a.enabled),
    [pack.accounts],
  );

  const data = useMemo((): uPlot.AlignedData => {
    if (chartData.length === 0) return [[0], [0], [0], [0], [0], [0], [0]];
    const timestamps: number[] = [];
    const p10Arr: number[] = [];
    const p90Arr: number[] = [];
    const p25Arr: number[] = [];
    const p75Arr: number[] = [];
    const p50Arr: number[] = [];
    const nwArr: number[] = [];
    const acctArrs: number[][] = enabledAccounts.map(() => []);

    for (const row of chartData) {
      const d = new Date(
        Number(String(row.date).split("-")[0]),
        Number(String(row.date).split("-")[1]) - 1,
        Number(String(row.date).split("-")[2]),
      );
      timestamps.push(d.getTime());
      const nw = Number(row.netWorth);
      const p50 = Number(row.p50 ?? nw);
      p10Arr.push(Number((row as any)._p10 ?? nw));
      p90Arr.push(Number((row as any)._p90 ?? nw));
      p25Arr.push(Number((row as any)._p25 ?? nw));
      p75Arr.push(Number((row as any)._p75 ?? nw));
      p50Arr.push(p50);
      nwArr.push(nw);

      let cum = 0;
      for (let i = 0; i < enabledAccounts.length; i++) {
        cum += Number(row[enabledAccounts[i].id] ?? 0);
        acctArrs[i].push(cum);
      }
    }

    return [timestamps, p10Arr, p90Arr, p25Arr, p75Arr, p50Arr, nwArr, ...acctArrs];
  }, [chartData, enabledAccounts]);

  const tooltipContent = useCallback(
    (self: uPlot, idx: number) => {
      const cd = chartData;
      const ts = (self.data[0] as number[])[idx];
      const d = new Date(ts);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const dateStr = formatDate(iso);

      const nw = (self.data[6] as number[])[idx];
      const p50 = (self.data[5] as number[])[idx];
      const displayNw = hasStochasticData ? p50 : nw;
      const p10 = (self.data[1] as number[])[idx];
      const p90 = (self.data[2] as number[])[idx];
      const p25 = (self.data[3] as number[])[idx];
      const p75 = (self.data[4] as number[])[idx];

      let html = `<div class="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm max-w-xs">`;
      html += `<div class="text-xs font-medium text-slate-500">${dateStr}</div>`;
      html += `<div class="mt-2 border-b border-slate-100 pb-1">`;
      html += `<div class="text-sm font-semibold text-slate-900">Net worth: ${currency.format(displayNw)}</div>`;

      if (hasStochasticData) {
        html += `<div class="mt-0.5 text-[10px] text-slate-500 leading-tight">`;
        html += `P10–P90: ${currency.format(p10)} – ${currency.format(p90)}<br />`;
        html += `P25–P75: ${currency.format(p25)} – ${currency.format(p75)}`;
        html += `</div>`;
      }

      html += `</div>`;
      html += `<div class="mt-1 max-h-[160px] overflow-y-auto space-y-0.5">`;

      const rawRow = cd[idx] as Record<string, number> | undefined;
      const nonZero: { id: string; label: string; color: string | null; val: number }[] = [];
      let zeroCount = 0;
      for (let i = 0; i < enabledAccounts.length; i++) {
        const a = enabledAccounts[i];
        const val = rawRow?.[a.id] ?? 0;
        if (val !== 0) {
          nonZero.push({ ...a, val });
        } else {
          zeroCount++;
        }
      }

      for (const acct of nonZero) {
        html += `<div class="flex justify-between gap-3 text-xs">`;
        html += `<span class="inline-flex items-center gap-1.5 text-slate-700">`;
        html += `<span class="inline-block h-2 w-2 rounded-full" style="background-color:${acct.color ?? "#64748b"}"></span>`;
        html += `${acct.label}</span>`;
        html += `<span class="tabular-nums text-slate-700">${currency.format(acct.val)}</span>`;
        html += `</div>`;
      }

      if (zeroCount > 0) {
        html += `<div class="flex justify-between gap-3 text-xs text-slate-400">`;
        html += `<span class="inline-flex items-center gap-1.5">`;
        html += `<span class="inline-block h-2 w-2 rounded-full bg-slate-300"></span>`;
        html += `${zeroCount} ${zeroCount === 1 ? "account" : "accounts"} at $0`;
        html += `</span>`;
        html += `<span class="tabular-nums">$0</span>`;
        html += `</div>`;
      }

      html += `</div></div>`;
      return html;
    },
    [hasStochasticData, enabledAccounts, chartData],
  );

  const options = useMemo((): uPlot.Options => {
    const base = createBaseOptions();
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
        label: a.label,
        show: true,
        stroke: a.color ?? "#334155",
        width: 1.5,
        fill: `${a.color ?? "#334155"}40`,
        points: { show: false },
      })),
    ];

    return {
      ...base,
      width: 0,
      height: 0,
      series,
      bands: hasStochasticData
        ? [
            { series: [1, 2], fill: "rgba(15,23,42,0.08)", dir: 1 as const },
            { series: [3, 4], fill: "rgba(15,23,42,0.15)", dir: 1 as const },
          ]
        : [],
      scales: {
        ...base.scales,
        y: {
          range: (_u: uPlot, min: number, max: number) => {
            const lower = Math.min(0, min);
            const upper = Math.max(targetNetWorth * 2, max * 1.1);
            return [lower, upper];
          },
        },
      },
      hooks: {
        ...createReferenceLinesHooks(targetNetWorth, milestoneDates),
      },
    };
  }, [targetNetWorth, hasStochasticData, milestoneDates, enabledAccounts]);

  return (
    <>
      <div className="min-w-0">
        <UPlotChart options={options} data={data} tooltipContent={tooltipContent} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1.5 text-xs text-slate-600">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#0f172a]" />
          {hasStochasticData ? "Net worth (median simulation)" : "Net worth"}
        </span>
        {enabledAccounts.map((a) => (
          <span key={a.id} className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: a.color ?? "#334155" }} />
            {a.label}
          </span>
        ))}
      </div>
    </>
  );
});
