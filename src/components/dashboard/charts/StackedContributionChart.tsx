import { memo, useCallback, useMemo, useState } from "react";
import type uPlot from "uplot";
import { parseChartDate } from "@/chart/chartData";
import {
	buildPointDetails,
	formatPointDetailsSummary,
} from "@/chart/pointDetails";
import {
	createBaseOptions,
	createReferenceLinesHooks,
} from "@/chart/uplotBase";
import { UPlotChart } from "@/components/ui/UPlotChart";
import type { FinancialModelDocument } from "@/lib/projection";
import { PointDetailsPanel } from "./PointDetailsPanel";

interface AccountMeta {
	id: string;
	label: string;
	color: string | null;
}

const NET_WORTH_CHART_MAX_Y = 2_000_000;
const FALLBACK_ACCOUNT_COLOR = "GrayText";
const NET_WORTH_SERIES_COLOR = "CanvasText";
const BAND_SOFT_COLOR = "color-mix(in oklab, CanvasText 15%, transparent)";
const BAND_COLOR = "color-mix(in oklab, CanvasText 25%, transparent)";

interface StackedContributionChartProps {
	document: FinancialModelDocument;
	hasStochasticData: boolean;
	stochasticIsProvisional?: boolean;
	chartData: Record<string, string | number>[];
	milestoneDates?: { hitTarget?: string; firstShortfall?: string };
}

export const StackedContributionChart = memo(function StackedContributionChart({
	document,
	hasStochasticData,
	stochasticIsProvisional = false,
	chartData,
	milestoneDates,
}: StackedContributionChartProps) {
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const enabledAccounts = useMemo(
		() => document.accounts.filter((account) => account.enabled),
		[document.accounts],
	);
	const { assets, liabilities } = useMemo(() => {
		const averageBalances = Object.fromEntries(
			enabledAccounts.map((account) => [account.id, 0]),
		);
		for (const row of chartData) {
			for (const account of enabledAccounts) {
				averageBalances[account.id] +=
					Number(row[account.id] ?? 0) / Math.max(chartData.length, 1);
			}
		}
		const byAscendingMagnitude = (a: AccountMeta, b: AccountMeta) =>
			Math.abs(averageBalances[a.id]) - Math.abs(averageBalances[b.id]);
		return {
			assets: enabledAccounts
				.filter((account) => averageBalances[account.id] >= 0)
				.sort(byAscendingMagnitude),
			liabilities: enabledAccounts
				.filter((account) => averageBalances[account.id] < 0)
				.sort(byAscendingMagnitude),
		};
	}, [chartData, enabledAccounts]);
	const accountCount = assets.length + liabilities.length;

	const data = useMemo((): uPlot.AlignedData => {
		const columnCount = 1 + accountCount + 2 + 4;
		if (chartData.length === 0) {
			return Array.from({ length: columnCount }, () => [
				0,
			]) as uPlot.AlignedData;
		}
		const timestamps: number[] = [];
		const assetCumulative: number[][] = assets.map(() => []);
		const liabilityCumulative: number[][] = liabilities.map(() => []);
		const p50: number[] = [];
		const netWorth: number[] = [];
		const p10: number[] = [];
		const p90: number[] = [];
		const p25: number[] = [];
		const p75: number[] = [];

		for (const row of chartData) {
			timestamps.push(parseChartDate(String(row.date)));
			const rowNetWorth = Number(row.netWorth);
			p50.push(Number(row.p50 ?? rowNetWorth));
			netWorth.push(rowNetWorth);
			let assetTotal = 0;
			for (let index = 0; index < assets.length; index++) {
				assetTotal += Number(row[assets[index].id] ?? 0);
				assetCumulative[index].push(assetTotal);
			}
			let liabilityTotal = 0;
			for (let index = 0; index < liabilities.length; index++) {
				liabilityTotal += Number(row[liabilities[index].id] ?? 0);
				liabilityCumulative[index].push(liabilityTotal);
			}
			p10.push(Number(row._p10 ?? rowNetWorth));
			p90.push(Number(row._p90 ?? rowNetWorth));
			p25.push(Number(row._p25 ?? rowNetWorth));
			p75.push(Number(row._p75 ?? rowNetWorth));
		}
		return [
			timestamps,
			...assetCumulative.slice().reverse(),
			...liabilityCumulative,
			p50,
			netWorth,
			p10,
			p90,
			p25,
			p75,
		];
	}, [accountCount, assets, chartData, liabilities]);

	const options = useMemo((): uPlot.Options => {
		const base = createBaseOptions();
		const fillSeries: uPlot.Series[] = [
			...assets.slice().reverse(),
			...liabilities,
		].map((account) => ({
			label: account.label,
			show: true,
			stroke: account.color ?? FALLBACK_ACCOUNT_COLOR,
			width: 1.5,
			fill: account.color ?? FALLBACK_ACCOUNT_COLOR,
			points: { show: false },
		}));
		const bandIndex = 1 + accountCount + 2;
		return {
			...base,
			width: 0,
			height: 0,
			legend: { show: false },
			series: [
				{},
				...fillSeries,
				{
					label: `${stochasticIsProvisional ? "Provisional " : ""}median net worth`,
					show: hasStochasticData,
					stroke: NET_WORTH_SERIES_COLOR,
					width: 2.5,
					points: { show: false },
				},
				{
					label: "Net worth",
					show: !hasStochasticData,
					stroke: NET_WORTH_SERIES_COLOR,
					width: 2.5,
					points: { show: false },
				},
				...Array.from({ length: 4 }, () => ({
					show: hasStochasticData,
					stroke: "transparent",
					width: 0.5,
					points: { show: false },
				})),
			],
			bands: hasStochasticData
				? [
						{
							series: [bandIndex, bandIndex + 1],
							fill: BAND_SOFT_COLOR,
							dir: 1,
						},
						{
							series: [bandIndex + 2, bandIndex + 3],
							fill: BAND_COLOR,
							dir: 1,
						},
					]
				: [],
			scales: {
				...base.scales,
				y: {
					range: (_chart: uPlot, min: number) => [
						Math.min(min, -500),
						NET_WORTH_CHART_MAX_Y,
					],
				},
			},
			hooks: createReferenceLinesHooks(milestoneDates),
		};
	}, [
		accountCount,
		assets,
		hasStochasticData,
		stochasticIsProvisional,
		liabilities,
		milestoneDates,
	]);

	const selectedDetails = useMemo(() => {
		const row = selectedIndex == null ? undefined : chartData[selectedIndex];
		return row
			? buildPointDetails({ row, accounts: enabledAccounts, hasStochasticData })
			: null;
	}, [chartData, enabledAccounts, hasStochasticData, selectedIndex]);
	const handleCursorChange = useCallback((index: number | null) => {
		setSelectedIndex(index);
	}, []);

	return (
		<div className="min-w-0">
			<UPlotChart
				options={options}
				data={data}
				tooltip={
					selectedDetails ? (
						<PointDetailsPanel details={selectedDetails} compact />
					) : null
				}
				onCursorChange={handleCursorChange}
				desktopTooltipOnly
			/>
			<ChartEncodingLegend
				hasStochasticData={hasStochasticData}
				stochasticIsProvisional={stochasticIsProvisional}
			/>
			{selectedDetails && (
				<>
					<PointDetailsPanel
						key={selectedIndex}
						details={selectedDetails}
						onClear={() => setSelectedIndex(null)}
					/>
					<span className="sr-only" aria-live="polite">
						{formatPointDetailsSummary(selectedDetails)}
					</span>
				</>
			)}
		</div>
	);
});

function ChartEncodingLegend({
	hasStochasticData,
	stochasticIsProvisional,
}: {
	hasStochasticData: boolean;
	stochasticIsProvisional: boolean;
}) {
	return (
		<div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-2 type-caption text-muted-foreground">
			<span className="inline-flex items-center gap-1.5">
				<span className="h-0.5 w-4 bg-foreground" />
				{hasStochasticData
					? `${stochasticIsProvisional ? "Provisional " : ""}median net worth`
					: "Net worth"}
			</span>
			<span className="inline-flex items-center gap-1.5">
				<span className="flex h-2.5 w-4 overflow-hidden rounded-sm">
					<span className="w-1/3 bg-sky-500" />
					<span className="w-1/3 bg-emerald-500" />
					<span className="w-1/3 bg-amber-500" />
				</span>
				Accounts
			</span>
			{hasStochasticData && (
				<>
					<span className="inline-flex items-center gap-1.5">
						<span className="h-2.5 w-4 rounded-sm bg-foreground/25" />
						Likely range <span className="text-[10px]">P25-P75</span>
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span className="h-2.5 w-4 rounded-sm bg-foreground/15" />
						Wider range <span className="text-[10px]">P10-P90</span>
					</span>
				</>
			)}
		</div>
	);
}
