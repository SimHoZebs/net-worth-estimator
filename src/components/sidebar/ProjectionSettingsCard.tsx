import { memo, useEffect, useState } from "react";
import type { ProjectionRuntimeSettings } from "@/lib/projection";
import { formatCurrencyInput, formatDate } from "@/lib/format";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface ProjectionSettingsCardProps {
  projectionSettings: ProjectionRuntimeSettings;
  projectionStartDate: string;
  activeOverrideCount: number;
  onTargetNetWorthChange: (value: number) => void;
  onProjectionSettingsChange?: (partial: Partial<ProjectionRuntimeSettings>) => void;
}

export const ProjectionSettingsCard = memo(function ProjectionSettingsCard({
  projectionSettings,
  projectionStartDate,
  activeOverrideCount,
  onTargetNetWorthChange,
  onProjectionSettingsChange,
}: ProjectionSettingsCardProps) {
  const [isTargetFocused, setIsTargetFocused] = useState(false);
  const [targetDraft, setTargetDraft] = useState(String(projectionSettings.targetNetWorth));

  useEffect(() => {
    if (!isTargetFocused) {
      setTargetDraft(String(projectionSettings.targetNetWorth));
    }
  }, [isTargetFocused, projectionSettings.targetNetWorth]);

  const commitTargetNetWorth = () => {
    const nextTarget = Number(targetDraft);
    if (Number.isFinite(nextTarget)) {
      onTargetNetWorthChange(nextTarget);
      setTargetDraft(String(nextTarget));
    } else {
      setTargetDraft(String(projectionSettings.targetNetWorth));
    }
    setIsTargetFocused(false);
  };

  return (
    <Card className="rounded-[1.4rem] border-slate-200 shadow-sm">
      <CardHeader>
        <CardTitle>Projection settings</CardTitle>
        <CardDescription>Session-only controls for the current projection.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Target net worth</div>
          {isTargetFocused ? (
            <input
              type="number"
              inputMode="numeric"
              step={1000}
              autoFocus
              value={targetDraft}
              onChange={(event) => setTargetDraft(event.currentTarget.value)}
              onBlur={commitTargetNetWorth}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitTargetNetWorth();
                if (event.key === "Escape") {
                  setTargetDraft(String(projectionSettings.targetNetWorth));
                  setIsTargetFocused(false);
                }
              }}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-xl font-semibold text-slate-900 shadow-sm outline-none transition focus:border-slate-400"
            />
          ) : (
            <button
              type="button"
              onClick={() => setIsTargetFocused(true)}
              className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xl font-semibold text-slate-900 shadow-sm outline-none transition hover:border-slate-300 focus:border-slate-400"
            >
              {formatCurrencyInput(targetDraft)}
            </button>
          )}
          <div className="mt-1 text-xs text-slate-400">Nominal dollars</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Horizon</div>
            <span className="text-lg font-semibold text-slate-900">{projectionSettings.horizonYears} yr</span>
          </div>
          <input
            type="range"
            min={5}
            max={50}
            step={1}
            value={projectionSettings.horizonYears}
            onChange={(event) => onProjectionSettingsChange?.({ horizonYears: Number(event.target.value) })}
            className="mt-2 w-full accent-slate-900"
          />
          <div className="mt-1 text-xs text-slate-400">From {formatDate(projectionStartDate)}</div>
        </div>

        <div className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white px-4 py-3">
          <div>
            <div className="text-xs font-medium uppercase tracking-[0.16em] text-slate-500">Overrides</div>
            <div className="mt-0.5 text-xs text-slate-400">
              {activeOverrideCount === 0 ? "Baseline only" : "Temporary scenario changes"}
            </div>
          </div>
          <div className="text-xl font-semibold text-slate-900">{activeOverrideCount === 0 ? "None" : activeOverrideCount}</div>
        </div>
      </CardContent>
    </Card>
  );
});
