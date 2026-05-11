import { memo } from "react";
import type {
  DataSource,
  ProjectionRuntimeSettings,
  ScenarioPack,
  StochasticProjectionResult,
} from "@/lib/projection";
import { StochasticControls } from "@/components/StochasticControls";
import { ModelAssumptionsCard } from "./ModelAssumptionsCard";
import { ProjectionSettingsCard } from "./ProjectionSettingsCard";
import { SourceStatusCard } from "./SourceStatusCard";

interface ProjectionConfigSidebarProps {
  pack: ScenarioPack;
  projectionSettings: ProjectionRuntimeSettings;
  projectionStartDate: string;
  activeOverrideCount: number;
  hasStochasticAccounts: boolean;
  stochasticResult: StochasticProjectionResult | null;
  isStochasticRunning: boolean;
  stochasticProgress: number | null;
  dataSource: DataSource;
  dataUpdatedAt: number;
  isLoading: boolean;
  loadError: string | null;
  sourceActionError: string | null;
  onTargetNetWorthChange: (value: number) => void;
  onProjectionSettingsChange?: (partial: Partial<ProjectionRuntimeSettings>) => void;
  onReload: () => void;
  onResetSource?: () => void;
  isResetting: boolean;
}

export const ProjectionConfigSidebar = memo(function ProjectionConfigSidebar({
  pack,
  projectionSettings,
  projectionStartDate,
  activeOverrideCount,
  hasStochasticAccounts,
  stochasticResult,
  isStochasticRunning,
  stochasticProgress,
  dataSource,
  dataUpdatedAt,
  isLoading,
  loadError,
  sourceActionError,
  onTargetNetWorthChange,
  onProjectionSettingsChange,
  onReload,
  onResetSource,
  isResetting,
}: ProjectionConfigSidebarProps) {
  return (
    <div className="space-y-4">
      <ProjectionSettingsCard
        projectionSettings={projectionSettings}
        projectionStartDate={projectionStartDate}
        activeOverrideCount={activeOverrideCount}
        onTargetNetWorthChange={onTargetNetWorthChange}
        onProjectionSettingsChange={onProjectionSettingsChange}
      />

      <StochasticControls
        compact
        hasStochasticAccounts={hasStochasticAccounts}
        stochasticResult={stochasticResult}
        isRunning={isStochasticRunning}
        progress={stochasticProgress}
      />

      <ModelAssumptionsCard pack={pack} hasStochasticData={stochasticResult !== null} />

      <SourceStatusCard
        dataSource={dataSource}
        dataUpdatedAt={dataUpdatedAt}
        projectionStartDate={projectionStartDate}
        isLoading={isLoading}
        loadError={loadError}
        sourceActionError={sourceActionError}
        onReload={onReload}
        onResetSource={onResetSource}
        isResetting={isResetting}
      />
    </div>
  );
});
