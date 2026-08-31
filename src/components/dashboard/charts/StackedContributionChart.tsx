import { memo, useCallback, useMemo, useRef, useState } from "react";
import type uPlot from "uplot";
import { parseChartDate, type StochasticChartRow } from "@/chart/chartData";
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

interface AccountGroups {
	assets: AccountMeta[];
	liabilities: AccountMeta[];
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
	stochasticChartData: StochasticChartRow[] | null;
	milestoneDates?: { hitTarget?: string; firstShortfall?: string };
}

export const StackedContributionChart = memo(function StackedContributionChart({
	document,
	hasStochasticData,
	stochasticIsProvisional = false,
	chartData,
	stochasticChartData,
	milestoneDates,
}: StackedContributionChartProps) {
	const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
	const enabledAccounts = useMemo(
		() => document.accounts.filter((account) => account.enabled),
		[document.accounts],
	);
	const nextAccountGroups = useMemo(() => {
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
	const { assets, liabilities } = useStableAccountGroups(nextAccountGroups);
	const accountCount = assets.length + liabilities.length;
	const dataTransition = useMemo(() => {
		const medianIndex = 1 + accountCount;
		return {
			seriesIndexes: [
				medianIndex,
				medianIndex + 2,
				medianIndex + 3,
				medianIndex + 4,
				medianIndex + 5,
			],
			durationMs: 200,
		};
	}, [accountCount]);

	const deterministicData = useMemo(() => {
		if (chartData.length === 0) {
			return {
				timestamps: [0],
				accountSeries: Array.from({ length: accountCount }, () => [0]),
				netWorth: [0],
			};
		}
		const timestamps: number[] = [];
		const assetCumulative: number[][] = assets.map(() => []);
		const liabilityCumulative: number[][] = liabilities.map(() => []);
		const netWorth: number[] = [];

		for (const row of chartData) {
			timestamps.push(parseChartDate(String(row.date)));
			const rowNetWorth = Number(row.netWorth);
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
		}
		return {
			timestamps,
			accountSeries: [
				...assetCumulative.slice().reverse(),
				...liabilityCumulative,
			],
			netWorth,
		};
	}, [accountCount, assets, chartData, liabilities]);
	const stochasticByDate = useMemo(() => {
		const index = new Map<string, StochasticChartRow>();
		for (const row of stochasticChartData ?? []) {
			if (!index.has(row.date)) index.set(row.date, row);
		}
		return index;
	}, [stochasticChartData]);
	const stochasticSeries = useMemo(() => {
		if (chartData.length === 0) {
			return { p50: [0], p10: [0], p90: [0], p25: [0], p75: [0] };
		}
		const p50: number[] = [];
		const p10: number[] = [];
		const p90: number[] = [];
		const p25: number[] = [];
		const p75: number[] = [];
		for (const row of chartData) {
			const rowNetWorth = Number(row.netWorth);
			const stochastic = stochasticByDate.get(String(row.date));
			p50.push(stochastic?.p50 ?? rowNetWorth);
			p10.push(stochastic?._p10 ?? rowNetWorth);
			p90.push(stochastic?._p90 ?? rowNetWorth);
			p25.push(stochastic?._p25 ?? rowNetWorth);
			p75.push(stochastic?._p75 ?? rowNetWorth);
		}
		return { p50, p10, p90, p25, p75 };
	}, [chartData, stochasticByDate]);
	const data = useMemo(
		(): uPlot.AlignedData => [
			deterministicData.timestamps,
			...deterministicData.accountSeries,
			stochasticSeries.p50,
			deterministicData.netWorth,
			stochasticSeries.p10,
			stochasticSeries.p90,
			stochasticSeries.p25,
			stochasticSeries.p75,
		],
		[deterministicData, stochasticSeries],
	);

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
		const stochastic = row ? stochasticByDate.get(String(row.date)) : undefined;
		return row
			? buildPointDetails({
					row: stochastic ? { ...row, ...stochastic } : row,
					accounts: enabledAccounts,
					hasStochasticData,
				})
			: null;
	}, [
		chartData,
		enabledAccounts,
		hasStochasticData,
		selectedIndex,
		stochasticByDate,
	]);
	const handleCursorChange = useCallback((index: number | null) => {
		setSelectedIndex(index);
	}, []);

	return (
		<div className="min-w-0">
			<UPlotChart
				options={options}
				data={data}
				dataTransition={hasStochasticData ? dataTransition : undefined}
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

function useStableAccountGroups(nextGroups: AccountGroups): AccountGroups {
	const groupsRef = useRef(nextGroups);
	if (!accountGroupsMatch(groupsRef.current, nextGroups)) {
		groupsRef.current = nextGroups;
	}
	return groupsRef.current;
}

function accountGroupsMatch(
	left: AccountGroups,
	right: AccountGroups,
): boolean {
	return (
		accountListsMatch(left.assets, right.assets) &&
		accountListsMatch(left.liabilities, right.liabilities)
	);
}

function accountListsMatch(
	left: readonly AccountMeta[],
	right: readonly AccountMeta[],
): boolean {
	return (
		left.length === right.length &&
		left.every(
			(account, index) =>
				account.id === right[index].id &&
				account.label === right[index].label &&
				account.color === right[index].color,
		)
	);
}

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
