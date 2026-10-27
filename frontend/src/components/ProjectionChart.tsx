import { CircleHelp } from "lucide-react";
import { useId, useMemo, useState } from "react";
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
import { Skeleton } from "./Skeleton.tsx";

export function ProjectionChart({
	projection,
	onEvidence,
	pending = false,
}: {
	projection: Projection | null;
	onEvidence: () => void;
	pending?: boolean;
}) {
	const [inspected, setInspected] = useState<number | null>(null);
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
							points: trailingDailyPoints(
								projection.points,
								today,
								TRAILING_NET_WORTH_DAYS,
							),
						},
						range: null,
						inflation: 0,
						realTerms: false,
						narrow,
					})
				: null,
		[projection, narrow, today],
	);
	const defaultIndex = useMemo(
		() => (model ? nearestPointIndex(model.points, today) : 0),
		[model, today],
	);
	const selectedIndex = model
		? Math.min(inspected ?? defaultIndex, model.points.length - 1)
		: 0;
	const point = model?.points[selectedIndex] ?? model?.last;
	// The evidence action lives here so the position breakdown stays
	// reachable; the dialog fetches its own data.
	const evidence = (
		<div className="flex justify-end px-5 pt-4">
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
				aria-label="Net worth over the trailing 30 days"
			>
				{evidence}
				<div aria-busy="true">
					<Skeleton className="h-56 w-full" />
				</div>
			</section>
		);
	}
	return (
		<section
			className="overflow-hidden rounded-surface border border-line bg-surface print:break-inside-avoid"
			aria-label="Net worth over the trailing 30 days"
		>
			{evidence}
			<div className="relative grid grid-cols-[--spacing(12)_minmax(0,1fr)_--spacing(4)] px-2">
				<ProjectionPlot
					model={model}
					id={id}
					inspected={inspected}
					selectedIndex={selectedIndex}
					onInspect={setInspected}
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
			<div
				className="mx-5 mt-1 mb-5 flex min-h-15 flex-wrap content-center gap-x-3 gap-y-2 rounded-control bg-surface-2 px-3 py-2 text-xs tabular-nums"
				aria-live="polite"
			>
				<strong>{dateLabel(point.date)}</strong>
				<span className="text-muted">
					<b className="ml-1 text-ink">
						{money(model.adjust(point.total, point.date))}
					</b>
				</span>
			</div>
		</section>
	);
}
