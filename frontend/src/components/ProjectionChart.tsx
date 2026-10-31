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
import { useElementWidth } from "../state/useElementWidth.ts";
import { useSavedAccounts } from "../state/savedRows.ts";
import { visibleAccounts } from "../domain/model.ts";
import { IconButton } from "./Button.tsx";
import { ProjectionPlot } from "./chart/ProjectionPlot.tsx";
import { ContributionStackPlot } from "./chart/ContributionStackPlot.tsx";
import { NetWorthSummary } from "./chart/NetWorthSummary.tsx";
import { Skeleton } from "./Skeleton.tsx";
import { SegmentedControl } from "./SegmentedControl.tsx";

const EMPTY_CHECKPOINTS: BackendCheckpoint[] = [];

export function ProjectionChart({ onEvidence }: { onEvidence: () => void }) {
  const [inspected, setInspected] = useState<number | null>(null);
  const [pinned, setPinned] = useState<number | null>(null);
  const [days, setDays] = useState<number>(TRAILING_NET_WORTH_DAYS);
  const [view, setView] = useState<"total" | "accounts">("total");
  const narrow = useMediaQuery(viewportQueries.belowSm);
  const id = useId().replaceAll(":", "");
  const [plotWrapRef, plotWrapWidth] = useElementWidth<HTMLDivElement>();
  // Render the viewBox at the container's native pixel width so desktop does
  // not just stretch the mobile artwork: one viewBox unit stays close to one
  // CSS pixel and strokes keep their weight. Falls back to the
  // narrow/desktop defaults before the first measurement.
  const measuredWidth =
    plotWrapWidth === null ? null : Math.max(280, Math.round(plotWrapWidth - 16));
  const measuredHeight =
    measuredWidth === null
      ? null
      : measuredWidth < 480
        ? 260
        : measuredWidth < 760
          ? 300
          : 340;
  const checkpoints = useCheckpoints().data?.checkpoints ?? EMPTY_CHECKPOINTS;
  const savedAccounts = useSavedAccounts();
  const stackAccounts = useMemo(
    () =>
      visibleAccounts(savedAccounts ?? [])
        .filter((account) => account.enabled)
        .map((account) => ({
          id: account.id,
          name: account.name,
        })),
    [savedAccounts],
  );
  // Outlook pins the horizon; the chart subscribes to the same cached
  // forecast instead of receiving it as a prop.
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
            ...(measuredWidth === null ? {} : { width: measuredWidth }),
            ...(measuredHeight === null ? {} : { height: measuredHeight }),
          })
        : null,
    [projection, narrow, today, days, measuredWidth, measuredHeight],
  );
  const defaultIndex = useMemo(
    () => (model ? nearestPointIndex(model.points, today) : 0),
    [model, today],
  );
  const selectedIndex = model
    ? Math.min(inspected ?? pinned ?? defaultIndex, model.points.length - 1)
    : 0;
  const point = model?.points[selectedIndex] ?? model?.last;
  if (!model || !point) {
    // Only data slots skeletonize, and only while data is absent.
    if (!pending) return null;
    return (
      <section
        className="overflow-hidden rounded-surface border border-line bg-surface print:break-inside-avoid"
        aria-label={
          view === "total"
            ? `Net worth over the trailing ${days} days`
            : `Net worth by account over the trailing ${days} days`
        }
      >
        <div aria-busy="true">
          <Skeleton className="h-56 w-full" />
        </div>
      </section>
    );
  }
  return (
    <section
      className="overflow-hidden rounded-surface border border-line bg-surface print:break-inside-avoid"
      aria-label={
        view === "total"
          ? `Net worth over the trailing ${days} days`
          : `Net worth by account over the trailing ${days} days`
      }
    >
      {projection && (
        <NetWorthSummary
          projection={projection}
          checkpoints={checkpoints}
          actions={
            <>
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
              <SegmentedControl
                ariaLabel="Chart view"
                value={view}
                onChange={setView}
                items={[
                  { value: "total", label: "Total" },
                  { value: "accounts", label: "Accounts" },
                ]}
              />
              <IconButton
                icon={CircleHelp}
                size="sm"
                iconSize={14}
                className="size-6"
                label="Inspect current net worth evidence"
                onClick={onEvidence}
              />
            </>
          }
        />
      )}
      {view === "total" ? (
        <div ref={plotWrapRef} className="relative grid grid-cols-[--spacing(12)_minmax(0,1fr)_--spacing(4)] px-2">
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
      ) : (
        <div className="px-5 pt-2 pb-5">
          {savedAccounts === null ? (
            <div aria-busy="true">
              <Skeleton className="h-56 w-full" />
            </div>
          ) : (
            <ContributionStackPlot
              points={model.points}
              accounts={stackAccounts}
            />
          )}
        </div>
      )}
    </section>
  );
}
