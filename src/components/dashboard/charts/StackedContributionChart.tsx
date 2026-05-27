import { memo, useCallback, useMemo, useRef } from "react";
import type uPlot from "uplot";
import { parseChartDate } from "@/chart/chartData";
import {
	createBaseOptions,
	createReferenceLinesHooks,
	formatDate,
} from "@/chart/uplotBase";
import { UPlotChart } from "@/components/ui/UPlotChart";
import { currency } from "@/lib/format";
import type { ScenarioPack } from "@/lib/projection";
import { escapeHtml } from "@/lib/utils";

interface AccountMeta {
	id: string;
	label: string;
	color: string | null;
}

interface Classification {
	assets: AccountMeta[];
	liabilities: AccountMeta[];
}

const NET_WORTH_CHART_MAX_Y = 2_000_000;
const FALLBACK_ACCOUNT_COLOR = "GrayText";
const NET_WORTH_SERIES_COLOR = "CanvasText";
const BAND_SOFT_COLOR = "color-mix(in oklab, CanvasText 15%, transparent)";
const BAND_COLOR = "color-mix(in oklab, CanvasText 25%, transparent)";

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
	const prevRowCount = useRef(-1);
	const cache = useRef<Classification | null>(null);

	const { assets, liabilities } = useMemo(() => {
		const enabled = pack.accounts.filter((a) => a.enabled);
		const len = chartData.length;
		if (len === 0) return { assets: enabled, liabilities: [] as AccountMeta[] };
		if (len === prevRowCount.current && cache.current) return cache.current;
		prevRowCount.current = len;

		const avgBal: Record<string, number> = {};
		for (const a of enabled) avgBal[a.id] = 0;
		for (const row of chartData) {
			for (const a of enabled) {
				avgBal[a.id] += Number(row[a.id] ?? 0) / len;
			}
		}
		cache.current = {
			assets: enabled
				.filter((a) => avgBal[a.id] >= 0)
				.sort((a, b) => Math.abs(avgBal[a.id]) - Math.abs(avgBal[b.id])),
			liabilities: enabled
				.filter((a) => avgBal[a.id] < 0)
				.sort((a, b) => Math.abs(avgBal[a.id]) - Math.abs(avgBal[b.id])),
		};
		return cache.current;
	}, [chartData.length, pack.accounts, chartData]);

	const A = assets.length;
	const L = liabilities.length;

	const data = useMemo((): uPlot.AlignedData => {
		const numCols = 1 + A + L + 2 + 4;
		if (chartData.length === 0)
			return Array.from({ length: numCols }, () => [
				0,
			]) as unknown as uPlot.AlignedData;

		const timestamps: number[] = [];
		const assetCums: number[][] = assets.map(() => []);
		const liabCums: number[][] = liabilities.map(() => []);
		const p50Arr: number[] = [];
		const nwArr: number[] = [];
		const p10Arr: number[] = [];
		const p90Arr: number[] = [];
		const p25Arr: number[] = [];
		const p75Arr: number[] = [];

		for (const row of chartData) {
			timestamps.push(parseChartDate(String(row.date)));
			const nw = Number(row.netWorth);
			const p50 = Number(row.p50 ?? nw);
			p50Arr.push(p50);
			nwArr.push(nw);

			let cumA = 0;
			for (let i = 0; i < A; i++) {
				cumA += Number(row[assets[i].id] ?? 0);
				assetCums[i].push(cumA);
			}
			let cumL = 0;
			for (let i = 0; i < L; i++) {
				cumL += Number(row[liabilities[i].id] ?? 0);
				liabCums[i].push(cumL);
			}
			p10Arr.push(Number((row as any)._p10 ?? nw));
			p90Arr.push(Number((row as any)._p90 ?? nw));
			p25Arr.push(Number((row as any)._p25 ?? nw));
			p75Arr.push(Number((row as any)._p75 ?? nw));
		}

		return [
			timestamps,
			...assetCums.slice().reverse(),
			...liabCums,
			p50Arr,
			nwArr,
			p10Arr,
			p90Arr,
			p25Arr,
			p75Arr,
		];
	}, [chartData, assets, liabilities, A, L]);

	const _bandIdx = 1 + A + L + 2;

	const chartDataRef = useRef(chartData);
	chartDataRef.current = chartData;

	const tooltipContent = useCallback(
		(self: uPlot, idx: number) => {
			const cd = chartDataRef.current;
			const ts = (self.data[0] as number[])[idx];
			const d = new Date(ts);
			const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
			const dateStr = formatDate(iso);

			const p50Arr = self.data[1 + A + L] as number[];
			const nwArr = self.data[1 + A + L + 1] as number[];
			const displayNw = hasStochasticData ? p50Arr[idx] : nwArr[idx];

			const bi = 1 + A + L + 2;
			const p10 = (self.data[bi] as number[])[idx];
			const p90 = (self.data[bi + 1] as number[])[idx];
			const p25 = (self.data[bi + 2] as number[])[idx];
			const p75 = (self.data[bi + 3] as number[])[idx];

			let html = `<div class="max-w-xs rounded-lg border border-border/80 bg-card/95 px-3 py-2 shadow-xl backdrop-blur dark:border-white/10">`;
			html += `<div class="type-label">${dateStr}</div>`;
			html += `<div class="mt-2 border-b border-border/70 pb-1">`;
			html += `<div class="type-title">Net worth: ${currency.format(displayNw)}</div>`;
			if (hasStochasticData) {
				html += `<div class="mt-0.5 type-caption text-[10px] leading-tight">`;
				html += `P10–P90: ${currency.format(p10)} – ${currency.format(p90)}<br />`;
				html += `P25–P75: ${currency.format(p25)} – ${currency.format(p75)}`;
				html += `</div>`;
			}
			html += `</div>`;
			html += `<div class="mt-1 max-h-[160px] overflow-y-auto space-y-0.5">`;

			const rawRow = cd[idx] as Record<string, number> | undefined;
			for (const group of [assets, liabilities]) {
				for (const a of group) {
					const val = rawRow?.[a.id] ?? 0;
					html += `<div class="flex justify-between gap-3 type-caption">`;
					html += `<span class="inline-flex items-center gap-1.5 text-foreground/80">`;
					html += `<span class="inline-block h-2 w-2 rounded-full" style="background-color:${escapeHtml(a.color ?? FALLBACK_ACCOUNT_COLOR)}"></span>`;
					html += `${escapeHtml(a.label)}</span>`;
					html += `<span class="tabular-nums text-foreground/80">${currency.format(val)}</span>`;
					html += `</div>`;
				}
			}
			html += `</div></div>`;
			return html;
		},
		[hasStochasticData, assets, liabilities, A, L],
	);

	const options = useMemo((): uPlot.Options => {
		const base = createBaseOptions();
		const showP50 = hasStochasticData;
		const showNw = !hasStochasticData;

		const fillSeries: uPlot.Series[] = [];
		for (const a of assets.slice().reverse()) {
			fillSeries.push({
				label: a.label,
				show: true,
				stroke: a.color ?? FALLBACK_ACCOUNT_COLOR,
				width: 1.5,
				fill: a.color ?? FALLBACK_ACCOUNT_COLOR,
				points: { show: false },
			});
		}
		for (const a of liabilities) {
			fillSeries.push({
				label: a.label,
				show: true,
				stroke: a.color ?? FALLBACK_ACCOUNT_COLOR,
				width: 1.5,
				fill: a.color ?? FALLBACK_ACCOUNT_COLOR,
				points: { show: false },
			});
		}

		const mainLineSeries: uPlot.Series[] = [
			{
				label: showP50 ? "Net worth (median simulation)" : undefined,
				show: showP50,
				stroke: NET_WORTH_SERIES_COLOR,
				width: 2.5,
				points: { show: false },
			},
			{
				label: showNw ? "Net worth" : undefined,
				show: showNw,
				stroke: NET_WORTH_SERIES_COLOR,
				width: 2.5,
				points: { show: false },
			},
		];

		const bandBoundarySeries: uPlot.Series[] = [
			{
				show: hasStochasticData,
				stroke: "transparent",
				width: 0.5,
				points: { show: false },
			},
			{
				show: hasStochasticData,
				stroke: "transparent",
				width: 0.5,
				points: { show: false },
			},
			{
				show: hasStochasticData,
				stroke: "transparent",
				width: 0.5,
				points: { show: false },
			},
			{
				show: hasStochasticData,
				stroke: "transparent",
				width: 0.5,
				points: { show: false },
			},
		];

		const bi = 1 + A + L + 2;

		return {
			...base,
			width: 0,
			height: 0,
			series: [{}, ...fillSeries, ...mainLineSeries, ...bandBoundarySeries],
			bands: hasStochasticData
				? [
						{
							series: [bi, bi + 1],
							fill: BAND_SOFT_COLOR,
							dir: 1 as const,
						},
						{
							series: [bi + 2, bi + 3],
							fill: BAND_COLOR,
							dir: 1 as const,
						},
					]
				: [],
			scales: {
				...base.scales,
				y: {
					range: (_u: uPlot, min: number) => {
						const lower = Math.min(min, -500);
						return [lower, NET_WORTH_CHART_MAX_Y];
					},
				},
			},
			hooks: {
				...createReferenceLinesHooks(targetNetWorth, milestoneDates),
			},
		};
	}, [
		targetNetWorth,
		hasStochasticData,
		milestoneDates,
		assets,
		liabilities,
		A,
		L,
	]);

	return (
		<>
			<div className="min-w-0">
				<UPlotChart
					options={options}
					data={data}
					tooltipContent={tooltipContent}
				/>
			</div>
			<div className="flex flex-wrap items-center gap-x-4 gap-y-1 pt-1.5 type-caption">
				<span className="inline-flex items-center gap-1.5">
					<span
						className="inline-block h-2.5 w-2.5 rounded-sm"
						style={{ backgroundColor: NET_WORTH_SERIES_COLOR }}
					/>
					{hasStochasticData ? "Net worth (median simulation)" : "Net worth"}
				</span>
				{assets.map((a) => (
					<span key={a.id} className="inline-flex items-center gap-1.5">
						<span
							className="inline-block h-2.5 w-2.5 rounded-sm"
							style={{
								backgroundColor: a.color ?? FALLBACK_ACCOUNT_COLOR,
							}}
						/>
						{a.label}
					</span>
				))}
				{liabilities.map((a) => (
					<span key={a.id} className="inline-flex items-center gap-1.5">
						<span
							className="inline-block h-2.5 w-2.5 rounded-sm"
							style={{
								backgroundColor: a.color ?? FALLBACK_ACCOUNT_COLOR,
							}}
						/>
						{a.label}
					</span>
				))}
			</div>
		</>
	);
});
