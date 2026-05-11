import { memo } from "react";
import type { DataSource } from "@/lib/projection";
import { formatDate } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface SourceStatusCardProps {
  dataSource: DataSource;
  dataUpdatedAt: number;
  projectionStartDate: string;
  isLoading: boolean;
  loadError: string | null;
  sourceActionError: string | null;
  onReload: () => void;
  onResetSource?: () => void;
  isResetting: boolean;
}

function formatLoadedAt(dataUpdatedAt: number) {
  return dataUpdatedAt === 0 ? "Not loaded" : new Date(dataUpdatedAt).toLocaleString();
}

export const SourceStatusCard = memo(function SourceStatusCard({
  dataSource,
  dataUpdatedAt,
  projectionStartDate,
  isLoading,
  loadError,
  sourceActionError,
  onReload,
  onResetSource,
  isResetting,
}: SourceStatusCardProps) {
  const status = isLoading ? "Loading" : loadError ? "Load failed" : sourceActionError ? "Action failed" : "Loaded";
  const statusClassName = loadError || sourceActionError
    ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 text-red-700 dark:text-red-400"
    : isLoading
      ? "border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400"
      : "border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-400";

  return (
    <Card className="rounded-[1.4rem] border-slate-200 dark:border-slate-700 shadow-sm dark:shadow-slate-900/30">
      <CardHeader>
        <CardTitle>Source</CardTitle>
        <CardDescription>Load state and low-priority metadata.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-900 dark:text-slate-100">{dataSource.label}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">Projection starts {formatDate(projectionStartDate)}</div>
          </div>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClassName}`}>{status}</span>
        </div>

        <dl className="space-y-2 text-xs text-slate-500 dark:text-slate-400">
          <div className="flex justify-between gap-3">
            <dt>Last loaded</dt>
            <dd className="text-right text-slate-700 dark:text-slate-300">{formatLoadedAt(dataUpdatedAt)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Source type</dt>
            <dd className="text-right text-slate-700 dark:text-slate-300">{dataSource.sourceType}</dd>
          </div>
        </dl>

        <p className="text-xs text-slate-500 dark:text-slate-400">{dataSource.description}</p>

        <div className="flex flex-wrap justify-end gap-2">
          {dataSource.reset && onResetSource ? (
            <Button type="button" variant="ghost" size="sm" onClick={onResetSource} disabled={isLoading || isResetting}>
              {isResetting ? "Resetting..." : dataSource.reset.label}
            </Button>
          ) : null}
          <Button type="button" variant="secondary" size="sm" onClick={onReload} disabled={isLoading}>
            {isLoading ? "Loading..." : "Reload"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
});
