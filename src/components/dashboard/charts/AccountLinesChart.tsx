import { memo, useCallback, useMemo } from "react";
import type uPlot from "uplot";
import type { ScenarioPack } from "@/lib/projection";
import { currency } from "@/lib/format";
import { UPlotChart } from "@/components/ui/UPlotChart";
import { createBaseOptions, formatDate } from "@/chart/uplotBase";
import { parseChartDate } from "@/chart/chartData";

interface AccountLinesChartProps {
  pack: ScenarioPack;
  chartData: Record<string, string | number>[];
}

export const AccountLinesChart = memo(function AccountLinesChart({
  pack,
  chartData,
}: AccountLinesChartProps) {
  const enabledAccounts = useMemo(
    () => pack.accounts.filter((a) => a.enabled),
    [pack.accounts],
  );

  const data = useMemo((): uPlot.AlignedData => {
    if (chartData.length === 0) return [[0], [0]];
    const timestamps: number[] = [];
    const acctArrs: number[][] = enabledAccounts.map(() => []);

    for (const row of chartData) {
      timestamps.push(parseChartDate(String(row.date)));
      for (let i = 0; i < enabledAccounts.length; i++) {
        acctArrs[i].push(Number(row[enabledAccounts[i].id] ?? 0));
      }
    }

    return [timestamps, ...acctArrs];
  }, [chartData, enabledAccounts]);

  const tooltipContent = useCallback(
    (self: uPlot, idx: number) => {
      const cd = chartData;
      const ts = (self.data[0] as number[])[idx];
      const d = new Date(ts);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const dateStr = formatDate(iso);

      let html = `<div class="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm max-w-xs">`;
      html += `<div class="text-xs font-medium text-slate-500">${dateStr}</div>`;
      html += `<div class="mt-1 space-y-0.5">`;

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
    [enabledAccounts, chartData],
  );

  const options = useMemo((): uPlot.Options => {
    const base = createBaseOptions();

    const series: uPlot.Series[] = [
      {},
      ...enabledAccounts.map((a) => ({
        label: a.label,
        show: true,
        stroke: a.color ?? "#334155",
        width: 2,
        points: { show: false },
      })),
    ];

    return {
      ...base,
      width: 0,
      height: 0,
      series,
      bands: [],
      scales: {
        ...base.scales,
        y: {
          range: (_u: uPlot, min: number, max: number) => {
            const lower = Math.min(0, min);
            const upper = max * 1.1;
            return [lower, Math.max(upper, 1000)];
          },
        },
      },
    };
  }, [enabledAccounts]);

  return (
    <>
      <div className="min-w-0">
        <UPlotChart options={options} data={data} tooltipContent={tooltipContent} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1.5 text-xs text-slate-600">
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
