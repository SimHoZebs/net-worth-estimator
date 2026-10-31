import { CircleHelp } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { BackendCheckpoint } from "../api/contracts.ts";
import {
	nearestPointIndex,
	projectionChartModel,
	TRAILING_NET_WORTH_DAYS,
	trailingDailyPoints,
} from "../domain/chart.ts";
import { dateLabel, money, todayIso } from "../domain/format.ts";
import type { Projection } from "../domain/result.ts";
import { useMediaQuery, viewportQueries } from "../state/useMediaQuery.ts";
import { IconButton } from "./Button.tsx";
import { ProjectionPlot } from "./chart/ProjectionPlot.tsx";
import { NetWorthSummary } from "./chart/NetWorthSummary.tsx";
import { Skeleton } from "./Skeleton.tsx";

const EMPTY_CHECKPOINTS: BackendCheckpoint[] = [];

export function ProjectionChart({
	projection,
	checkpoints = EMPTY_CHECKPOINTS,
	onEvidence,
	pending = false,
}: {
	projection: Projection | null;
	checkpoints?: readonly BackendCheckpoint[];
	onEvidence: () => void;
	pending?: boolean;
}) {
	const [inspected, setInspected] = useState<number | null>(null);
	const [pinned, setPinned] = useState<number | null>(null);
	const [days, setDays] = useState<number>(TRAILING_NET_WORTH_DAYS);
	const narrow = useMediaQuery(viewportQueries.belowSm);
	const id = useId().replaceAll(":", "");
	// The graph covers only the trailing window ending today: sparse engine
	// rows expand into one daily point per day via latest-known fill. The
	// past already happened, so there is one observed line and no scenarios.
	const today = todayIso();
	const model = useMemo(
		() =>
			projection
				? projectionChartModel({
						projection: {
							...projection,
							points: trailingDailyPoints(projection.points, today, days),
						},
						range: null,
						inflation: 0,
						realTerms: false,
						narrow,
					})
				: null,
		[projection, narrow, today, days],
	);
	const defaultIndex = useMemo(
		() => (model ? nearestPointIndex(model.points, today) : 0),
		[model, today],
	);
	const selectedIndex = model
		? Math.min(inspected ?? pinned ?? defaultIndex, model.points.length - 1)
		: 0;
	const point = model?.points[selectedIndex] ?? model?.last;
	// The evidence action lives here so the position breakdown stays
	// reachable; the dialog fetches its own data.
	const topRow = (
		<div className="flex items-center justify-between gap-4 px-5 pt-4">
			<div
				className="inline-flex gap-0.5 rounded-control border border-line bg-surface-2 p-1"
				role="group"
				aria-label="Trailing window"
			>
				{[TRAILING_NET_WORTH_DAYS, 90].map((option) => (
					<button
						className="rounded-control border-0 bg-transparent px-2 py-1 text-xs whitespace-nowrap text-muted aria-pressed:bg-surface aria-pressed:font-bold aria-pressed:text-ink aria-pressed:shadow-xs"
						type="button"
						key={option}
						aria-pressed={days === option}
						onClick={() => {
							setDays(option);
							setInspected(null);
							setPinned(null);
						}}
					>
						{option} days
					</button>
				))}
			</div>
			<IconButton
				icon={CircleHelp}
				size="sm"
				iconSize={14}
				className="size-6"
				label="Inspect current net worth evidence"
				onClick={onEvidence}
			/>
		</div>
	);
	if (!model || !point) {
		// Only data slots skeletonize, and only while data is absent.
		if (!pending) return null;
		return (
			<section
				className="overflow-hidden rounded-surface border border-line bg-surface print:break-inside-avoid"
				aria-label={`Net worth over the trailing ${days} days`}
			>
				{topRow}
				<div aria-busy="true">
					<Skeleton className="h-56 w-full" />
				</div>
			</section>
		);
	}
	return (
		<section
			className="overflow-hidden rounded-surface border border-line bg-surface print:break-inside-avoid"
			aria-label={`Net worth over the trailing ${days} days`}
		>
			{projection && (
				<NetWorthSummary projection={projection} checkpoints={checkpoints} />
			)}
			{topRow}
			<div className="relative grid grid-cols-[--spacing(12)_minmax(0,1fr)_--spacing(4)] px-2">
				<ProjectionPlot
					model={model}
					id={id}
					inspected={inspected ?? pinned}
					selectedIndex={selectedIndex}
					onInspect={setInspected}
					onPin={(index) =>
						setPinned((previous) => (previous === index ? null : index))
					}
				/>
				<input
					className="relative col-start-2 row-start-1 h-3 w-full min-w-0 self-end cursor-ew-resize accent-primary opacity-0 focus-visible:opacity-100 print:hidden"
					type="range"
					min="0"
					max={model.points.length - 1}
					value={selectedIndex}
					aria-label="Inspect net worth date"
					aria-valuetext={`${dateLabel(point.date)}: ${money(model.adjust(point.total, point.date))}`}
					onChange={(event) => setInspected(Number(event.target.value))}
					onBlur={() => setInspected(null)}
				/>
			</div>
		</section>
	);
}
