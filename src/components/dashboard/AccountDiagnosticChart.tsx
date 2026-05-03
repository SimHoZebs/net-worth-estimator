import {
  Area,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useState } from "react";
import type { ScenarioPack } from "@/lib/projection";
import { currency, formatChartCurrencyTick } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface AccountDiagnosticChartProps {
  pack: ScenarioPack;
  targetNetWorth: number;
  hasStochasticData: boolean;
  chartData: Record<string, string | number>[];
  milestoneDates?: { hitTarget?: string; firstShortfall?: string };
}

export function AccountDiagnosticChart({
  pack,
  targetNetWorth,
  hasStochasticData,
  chartData,
  milestoneDates,
}: AccountDiagnosticChartProps) {
  const [viewMode, setViewMode] = useState<"net-worth" | "accounts">("net-worth");
  return (
    <section>
      <Card className="min-w-0 rounded-[1.8rem] border-slate-200 shadow-sm">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle>Net worth projection</CardTitle>
              <CardDescription>
                {viewMode === "net-worth" ? "Net worth over time with percentile ranges." : "Net worth over time with account breakdown."}
                {hasStochasticData ? " Shaded bands show P10–P90 and P25–P75 percentile ranges." : ""}
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
          <div className="min-w-0 h-[420px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 12, right: 24, left: 8, bottom: 12 }}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" minTickGap={36} />
                <YAxis tickFormatter={formatChartCurrencyTick} width={72} />
                <Legend
                  wrapperStyle={{ paddingTop: 8 }}
                  formatter={(value: string) => {
                    if (value === "netWorth") return "Net worth";
                    if (value === "p50") return "Net worth (median simulation)";
                    return value;
                  }}
                />
                <Tooltip
                  content={({ active, payload, label }) => {
                    if (!active || !payload || payload.length === 0) return null;
                    const data = payload[0]?.payload as Record<string, number> | undefined;
                    if (!data) return null;
                    return (
                      <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 shadow-sm max-w-xs">
                        <div className="text-xs font-medium text-slate-500">{label}</div>
                        <div className="mt-2 border-b border-slate-100 pb-1">
                          <div className="text-sm font-semibold text-slate-900">
                            Net worth: {currency.format(data.netWorth ?? 0)}
                          </div>
                          {hasStochasticData && data._hasStochastic ? (
                            <div className="mt-0.5 text-[10px] text-slate-500 leading-tight">
                              P10–P90: {currency.format(data._p10 ?? 0)} – {currency.format(data._p90 ?? 0)}
                              <br />
                              P25–P75: {currency.format(data._p25 ?? 0)} – {currency.format(data._p75 ?? 0)}
                            </div>
                          ) : null}
                        </div>
                        <div className="mt-1 max-h-[160px] overflow-y-auto space-y-0.5">
                          {pack.accounts.filter(a => a.enabled).map((account) => {
                            const balance = data[account.id];
                            if (balance === undefined) return null;
                            return (
                              <div key={account.id} className="flex justify-between gap-3 text-xs">
                                <span style={{ color: account.color ?? "#64748b" }}>{account.label}</span>
                                <span className="tabular-nums text-slate-700">{currency.format(balance)}</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }}
                />
                <ReferenceLine
                  y={targetNetWorth}
                  stroke="#334155"
                  strokeDasharray="5 5"
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                  label={{
                    value: `Target: ${currency.format(targetNetWorth)}`,
                    position: "insideTopRight",
                    fill: "#334155",
                    fontSize: 12,
                    fontWeight: 600,
                  }}
                />
                {milestoneDates?.hitTarget ? (
                  <ReferenceLine
                    x={milestoneDates.hitTarget}
                    stroke="#059669"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    label={{
                      value: "Target reached",
                      position: "insideTopLeft",
                      fill: "#059669",
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                  />
                ) : null}
                {milestoneDates?.firstShortfall ? (
                  <ReferenceLine
                    x={milestoneDates.firstShortfall}
                    stroke="#d97706"
                    strokeWidth={1.5}
                    strokeDasharray="4 4"
                    label={{
                      value: "First shortfall",
                      position: "insideTopLeft",
                      fill: "#d97706",
                      fontSize: 11,
                      fontWeight: 500,
                    }}
                  />
                ) : null}
                {hasStochasticData ? (
                  <>
                    <Area type="monotone" dataKey="p10_base" stackId="outer" stroke="none" fill="transparent" isAnimationActive={false} />
                    <Area type="monotone" dataKey="outerThickness" stackId="outer" stroke="none" fill="#0f172a" fillOpacity={0.05} isAnimationActive={false} />
                    <Area type="monotone" dataKey="p25_base" stackId="inner" stroke="none" fill="transparent" isAnimationActive={false} />
                    <Area type="monotone" dataKey="innerThickness" stackId="inner" stroke="none" fill="#0f172a" fillOpacity={0.10} isAnimationActive={false} />
                    <Line type="monotone" dataKey="p50" stroke="#0f172a" strokeWidth={2.5} dot={false} name="Net worth (P50)" isAnimationActive={false} />
                  </>
                ) : (
                  <Line type="monotone" dataKey="netWorth" stroke="#0f172a" strokeWidth={2.5} dot={false} name="Net worth" isAnimationActive={false} />
                )}
                {viewMode === "accounts" ? pack.accounts.filter(a => a.enabled).map((account) => (
                  <Line
                    key={account.id}
                    type="monotone"
                    dataKey={account.id}
                    stroke={account.color ?? "#64748b"}
                    strokeWidth={2}
                    strokeOpacity={0.85}
                    dot={false}
                    name={account.label}
                    isAnimationActive={false}
                  />
                )) : null}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>
    </section>
  );
}
