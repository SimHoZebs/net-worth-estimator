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
    ? "border-red-200 bg-red-50 text-red-700"
    : isLoading
      ? "border-amber-200 bg-amber-50 text-amber-700"
      : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <Card className="rounded-[1.4rem] border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle>Source</CardTitle>
        <CardDescription>Load state and low-priority metadata.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-medium text-slate-900">{dataSource.label}</div>
            <div className="text-xs text-slate-500">Projection starts {formatDate(projectionStartDate)}</div>
          </div>
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-medium ${statusClassName}`}>{status}</span>
        </div>

        <dl className="space-y-2 text-xs text-slate-500">
          <div className="flex justify-between gap-3">
            <dt>Last loaded</dt>
            <dd className="text-right text-slate-700">{formatLoadedAt(dataUpdatedAt)}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt>Source type</dt>
            <dd className="text-right text-slate-700">{dataSource.sourceType}</dd>
          </div>
        </dl>

        <p className="text-xs text-slate-500">{dataSource.description}</p>

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
