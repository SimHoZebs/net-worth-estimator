import { CircleHelp } from "lucide-react";
import { useId, useMemo, useState } from "react";
import {
  nearestPointIndex,
  projectionChartModel,
  TRAILING_NET_WORTH_DAYS,
  trailingDailyPoints,
} from "../domain/chart.ts";
import { dateLabel, money, todayIso } from "../domain/format.ts";
import type { BackendCheckpoint } from "../api/contracts.ts";
import { useCheckpoints } from "../state/workspaceResources.ts";
import { useRemoteProjection } from "../state/useRemoteProjection.ts";
import { useMediaQuery, viewportQueries } from "../state/useMediaQuery.ts";
import { IconButton } from "./Button.tsx";
import { ProjectionPlot } from "./chart/ProjectionPlot.tsx";
import { NetWorthSummary } from "./chart/NetWorthSummary.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { SegmentedControl } from "./SegmentedControl.tsx";

const EMPTY_CHECKPOINTS: BackendCheckpoint[] = [];

export function ProjectionChart({ onEvidence }: { onEvidence: () => void }) {
  const [inspected, setInspected] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [days, setDays] = useState<number>(TRAILING_NET_WORTH_DAYS);
  const narrow = useMediaQuery(viewportQueries.belowSm);
  const id = useId().replaceAll(":", "");
  // Outlook pins the horizon; the chart subscribes to the same cached
  // forecast instead of receiving it as a prop.
  const checkpoints = useCheckpoints().data?.checkpoints ?? EMPTY_CHECKPOINTS;
  const projectionQuery = useRemoteProjection({ years: 20, ranges: false });
  const projection =
    projectionQuery.base instanceof Error || projectionQuery.isPlaceholderData
      ? null
      : projectionQuery.base;
  const pending =
    projectionQuery.status === "pending" ||
    (projectionQuery.isPlaceholderData && projectionQuery.loading);
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
      <SegmentedControl
        ariaLabel="Trailing window"
        value={String(days)}
        onChange={(v) => {
          setDays(Number(v));
          setInspected(null);
          setPinned(null);
        }}
        items={[TRAILING_NET_WORTH_DAYS, 90].map((d) => ({
          value: String(d),
          label: `${d} days`,
        }))}
      />
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
