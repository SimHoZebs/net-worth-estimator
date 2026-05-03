import { memo, useCallback, useMemo, useState } from "react";
import type uPlot from "uplot";
import type { ScenarioPack } from "@/lib/projection";
import { currency } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UPlotChart } from "@/components/ui/UPlotChart";
import { buildUplotDiagnosticOptions, formatDate } from "@/chart/uplotData";

interface AccountDiagnosticChartProps {
  pack: ScenarioPack;
  targetNetWorth: number;
  hasStochasticData: boolean;
  chartData: Record<string, string | number>[];
  milestoneDates?: { hitTarget?: string; firstShortfall?: string };
}

export const AccountDiagnosticChart = memo(function AccountDiagnosticChart({
  pack,
  targetNetWorth,
  hasStochasticData,
  chartData,
  milestoneDates,
}: AccountDiagnosticChartProps) {
  const [viewMode, setViewMode] = useState<"net-worth" | "accounts">("net-worth");

  const enabledAccounts = useMemo(
    () => pack.accounts.filter((a) => a.enabled),
    [pack.accounts],
  );

  const tooltipContent = useCallback(
    (self: uPlot, idx: number) => {
      const data = self.data;
      const ts = (data[0] as number[])[idx];
      const d = new Date(ts);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const dateStr = formatDate(iso);

      const nw = (data[6] as number[])[idx];
      const p50 = (data[5] as number[])[idx];
      const displayNw = hasStochasticData ? p50 : nw;

      const p10 = (data[1] as number[])[idx];
      const p90 = (data[2] as number[])[idx];
      const p25 = (data[3] as number[])[idx];
      const p75 = (data[4] as number[])[idx];

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

      const nonZero: { id: string; label: string; color: string | null; val: number }[] = [];
      let zeroCount = 0;
      for (let i = 0; i < enabledAccounts.length; i++) {
        const a = enabledAccounts[i];
        const val = (data[7 + i] as number[])[idx];
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
    [hasStochasticData, enabledAccounts],
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
      const p10 = Number((row as any)._p10 ?? nw);
      const p90 = Number((row as any)._p90 ?? nw);
      const p25 = Number((row as any)._p25 ?? nw);
      const p75 = Number((row as any)._p75 ?? nw);
      p10Arr.push(p10);
      p90Arr.push(p90);
      p25Arr.push(p25);
      p75Arr.push(p75);
      p50Arr.push(p50);
      nwArr.push(nw);
      for (let i = 0; i < enabledAccounts.length; i++) {
        acctArrs[i].push(Number(row[enabledAccounts[i].id] ?? 0));
      }
    }

    return [timestamps, p10Arr, p90Arr, p25Arr, p75Arr, p50Arr, nwArr, ...acctArrs];
  }, [chartData, enabledAccounts]);

  const options = useMemo(
    () =>
      buildUplotDiagnosticOptions(
        targetNetWorth,
        hasStochasticData,
        milestoneDates ?? {},
        viewMode,
        enabledAccounts,
      ),
    [targetNetWorth, hasStochasticData, milestoneDates, viewMode, enabledAccounts],
  );

  return (
    <section>
      <Card className="min-w-0 rounded-[1.8rem] border-slate-200 shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Net worth projection</CardTitle>
              <CardDescription>
                {viewMode === "net-worth"
                  ? "Net worth over time with percentile ranges."
                  : "Net worth over time with account breakdown."}
                {hasStochasticData
                  ? " Shaded bands show P10–P90 and P25–P75 percentile ranges."
                  : ""}
              </CardDescription>
            </div>
            <button
              type="button"
              onClick={() => setViewMode(viewMode === "net-worth" ? "accounts" : "net-worth")}
              className="shrink-0 rounded-lg border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600 transition hover:border-slate-300 hover:text-slate-800 no-print"
            >
              {viewMode === "net-worth" ? "Show account breakdown" : "Net worth only"}
            </button>
          </div>
        </CardHeader>
        <CardContent className="min-w-0">
          <div className="min-w-0">
            <UPlotChart options={options} data={data} tooltipContent={tooltipContent} />
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1.5 text-xs text-slate-600">
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-[#0f172a]" />
              {hasStochasticData ? "Net worth (median simulation)" : "Net worth"}
            </span>
            {viewMode === "accounts"
              ? enabledAccounts.map((a) => (
                  <span key={a.id} className="inline-flex items-center gap-1.5">
                    <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: a.color ?? "#334155" }} />
                    {a.label}
                  </span>
                ))
              : null}
          </div>
        </CardContent>
      </Card>
    </section>
  );
});
