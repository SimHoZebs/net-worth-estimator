import { memo } from "react";
import { EvaluationList } from "@/components/evaluations/EvaluationList";
import { StochasticControls } from "@/components/StochasticControls";
import type {
	DataSource,
	FinancialIndependencePlan,
	ProjectionResult,
	ProjectionRuntimeSettings,
	ScenarioPack,
	StochasticProjectionResult,
} from "@/lib/projection";
import { ModelAssumptionsCard } from "./ModelAssumptionsCard";
import { ProjectionSettingsCard } from "./ProjectionSettingsCard";
import { SourceStatusCard } from "./SourceStatusCard";

interface ProjectionConfigSidebarProps {
	pack: ScenarioPack;
	projectionSettings: ProjectionRuntimeSettings;
	projectionResult: ProjectionResult;
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
	onFinancialIndependencePlanChange: (
		changes: Partial<FinancialIndependencePlan>,
	) => void;
	onProjectionSettingsChange?: (
		partial: Partial<ProjectionRuntimeSettings>,
	) => void;
	onReload: () => void;
	onResetSource?: () => void;
	isResetting: boolean;
}

export const ProjectionConfigSidebar = memo(function ProjectionConfigSidebar({
	pack,
	projectionSettings,
	projectionResult,
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
	onFinancialIndependencePlanChange,
	onProjectionSettingsChange,
	onReload,
	onResetSource,
	isResetting,
}: ProjectionConfigSidebarProps) {
	return (
		<div className="space-y-4">
			<EvaluationList results={stochasticResult ?? projectionResult} />
			<ProjectionSettingsCard
				projectionSettings={projectionSettings}
				projectionResult={projectionResult}
				projectionStartDate={projectionStartDate}
				activeOverrideCount={activeOverrideCount}
				pack={pack}
				onFinancialIndependencePlanChange={onFinancialIndependencePlanChange}
				onProjectionSettingsChange={onProjectionSettingsChange}
			/>

			<StochasticControls
				hasStochasticAccounts={hasStochasticAccounts}
				stochasticResult={stochasticResult}
				isRunning={isStochasticRunning}
				progress={stochasticProgress}
			/>

			<ModelAssumptionsCard
				pack={pack}
				hasStochasticData={stochasticResult !== null}
			/>

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
