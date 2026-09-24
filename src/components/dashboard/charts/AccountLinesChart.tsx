import { memo, useCallback, useId, useMemo, useState } from "react";
import type uPlot from "uplot";
import { parseChartDate } from "@/chart/chartData";
import {
	AccountColorDot,
	baseChartOptions,
	closeChartTooltip,
	openChartTooltip,
	resolveAccountColor,
} from "@/chart/chartView";
import { UPlotChart } from "@/components/ui/UPlotChart";
import { currency, formatDate, formatIsoDateLocal } from "@/lib/format";
import type { FinancialModelDocument } from "@/lib/projection";
import { escapeHtml } from "@/lib/utils";

interface AccountLinesChartProps {
	document: FinancialModelDocument;
	chartData: Record<string, string | number>[];
}

const LEGEND_COLLAPSE_AFTER = 8;

export const AccountLinesChart = memo(function AccountLinesChart({
	document,
	chartData,
}: AccountLinesChartProps) {
	const [showDataTable, setShowDataTable] = useState(false);
	const figcaptionId = useId();
	const enabledAccounts = useMemo(
		() => document.accounts.filter((a) => a.enabled),
		[document.accounts],
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
			const iso = formatIsoDateLocal(new Date(ts));
			const dateStr = formatDate(iso);

			let html = openChartTooltip(dateStr);

			const rawRow = cd[idx] as Record<string, number> | undefined;
			const nonZero: {
				id: string;
				label: string;
				val: number;
			}[] = [];
			let zeroCount = 0;
			for (let i = 0; i < enabledAccounts.length; i++) {
				const a = enabledAccounts[i];
				const val = rawRow?.[a.id] ?? 0;
				if (val !== 0) {
					nonZero.push({ id: a.id, label: a.label, val });
				} else {
					zeroCount++;
				}
			}

			for (const acct of nonZero) {
				const account = enabledAccounts.find((a) => a.id === acct.id);
				const color = resolveAccountColor(account?.color);
				html += `<div class="flex justify-between gap-3 type-caption">`;
				html += `<span class="inline-flex items-center gap-1.5 text-foreground/80">`;
				html += `<span class="inline-block h-2 w-2 rounded-full" style="background-color:${escapeHtml(color)}"></span>`;
				html += `${escapeHtml(acct.label)}</span>`;
				html += `<span class="tabular-nums text-foreground/80">${currency.format(acct.val)}</span>`;
				html += `</div>`;
			}

			if (zeroCount > 0) {
				html += `<div class="flex justify-between gap-3 type-caption text-muted-foreground/70">`;
				html += `<span class="inline-flex items-center gap-1.5">`;
				html += `<span class="inline-block h-2 w-2 rounded-full bg-muted-foreground/50"></span>`;
				html += `${zeroCount} ${zeroCount === 1 ? "account" : "accounts"} at $0`;
				html += `</span>`;
				html += `<span class="tabular-nums">$0</span>`;
				html += `</div>`;
			}

			html += closeChartTooltip();
			return html;
		},
		[enabledAccounts, chartData],
	);

	const options = useMemo((): uPlot.Options => {
		const base = baseChartOptions();

		const series: uPlot.Series[] = [
			{},
			...enabledAccounts.map((a) => ({
				label: a.label,
				show: true,
				stroke: resolveAccountColor(a.color),
				width: 2,
				points: { show: false },
			})),
		];

		return {
			...base,
			series,
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

	const visibleLegend = enabledAccounts.slice(0, LEGEND_COLLAPSE_AFTER);
	const hiddenLegend = enabledAccounts.slice(LEGEND_COLLAPSE_AFTER);
	const sampledRows = useMemo(() => {
		if (chartData.length <= 12) return chartData;
		const step = Math.ceil(chartData.length / 12);
		return chartData.filter((_, i) => i % step === 0);
	}, [chartData]);

	return (
		<figure className="min-w-0" aria-describedby={figcaptionId}>
			<figcaption id={figcaptionId} className="sr-only">
				Account balance lines over the projection horizon. An equivalent data
				table is available behind the “Show data table” toggle.
			</figcaption>
			<div className="mt-2 min-w-0">
				<UPlotChart
					options={options}
					data={data}
					tooltipContent={tooltipContent}
				/>
			</div>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1.5 type-caption">
				{visibleLegend.map((a) => (
					<span key={a.id} className="inline-flex items-center gap-1.5">
						<AccountColorDot color={a.color} />
						{a.label}
					</span>
				))}
				{hiddenLegend.length > 0 ? (
					<details className="inline-flex">
						<summary className="cursor-pointer underline decoration-border underline-offset-4">
							Show all accounts
						</summary>
						<span className="flex flex-wrap items-center gap-x-4 gap-y-1">
							{hiddenLegend.map((a) => (
								<span key={a.id} className="inline-flex items-center gap-1.5">
									<AccountColorDot color={a.color} />
									{a.label}
								</span>
							))}
						</span>
					</details>
				) : null}
			</div>
			<div className="no-print mt-2">
				<button
					type="button"
					onClick={() => setShowDataTable((v) => !v)}
					aria-expanded={showDataTable}
					className="rounded-lg border border-border/80 px-2.5 py-1 type-label transition hover:bg-accent"
				>
					{showDataTable ? "Hide data table" : "Show data table"}
				</button>
			</div>
			{showDataTable ? (
				<div className="relative mt-2 overflow-x-auto overscroll-x-contain rounded-xl border border-border/70">
					<table className="w-full type-caption">
						<caption className="sr-only">
							Sampled account balances by date
						</caption>
						<thead>
							<tr className="border-b border-border/70 bg-muted/55 text-left">
								<th scope="col" className="sticky left-0 bg-muted px-2 py-1.5">
									Date
								</th>
								{enabledAccounts.slice(0, 6).map((a) => (
									<th scope="col" key={a.id} className="px-2 py-1.5 text-right">
										{a.label}
									</th>
								))}
							</tr>
						</thead>
						<tbody>
							{sampledRows.map((row) => (
								<tr
									key={String(row.date)}
									className="border-b border-border/60 last:border-0"
								>
									<th
										scope="row"
										className="sticky left-0 bg-card px-2 py-1.5 text-left font-medium"
									>
										{formatDate(String(row.date))}
									</th>
									{enabledAccounts.slice(0, 6).map((a) => (
										<td
											key={a.id}
											className="px-2 py-1.5 text-right tabular-nums"
										>
											{currency.format(Number(row[a.id] ?? 0))}
										</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
					<div
						aria-hidden
						className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-background to-transparent"
					/>
				</div>
			) : null}
		</figure>
	);
});
