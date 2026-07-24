import { memo } from "react";
import { StochasticControls } from "@/components/StochasticControls";
import type {
	DataSource,
	FinancialModelDocument,
	ProjectionRuntimeSettings,
	StochasticProjectionResult,
} from "@/lib/projection";
import { ModelAssumptionsCard } from "./ModelAssumptionsCard";
import { SimulationSettingsCard } from "./SimulationSettingsCard";
import { SourceStatusCard } from "./SourceStatusCard";

interface ProjectionConfigSidebarProps {
	document: FinancialModelDocument;
	projectionSettings: ProjectionRuntimeSettings;
	projectionStartDate: string;
	currentChangeCount: number;
	hasStochasticAccounts: boolean;
	stochasticResult: StochasticProjectionResult | null;
	isStochasticRunning: boolean;
	stochasticProgress: number | null;
	dataSource: DataSource;
	dataUpdatedAt: number;
	isLoading: boolean;
	loadError: string | null;
	sourceActionError: string | null;
	onProjectionSettingsChange?: (
		partial: Partial<ProjectionRuntimeSettings>,
	) => void;
	onReload: () => void;
	onResetSource?: () => void;
	isResetting: boolean;
}

export const ProjectionConfigSidebar = memo(function ProjectionConfigSidebar({
	document,
	projectionSettings,
	projectionStartDate,
	currentChangeCount,
	hasStochasticAccounts,
	stochasticResult,
	isStochasticRunning,
	stochasticProgress,
	dataSource,
	dataUpdatedAt,
	isLoading,
	loadError,
	sourceActionError,
	onProjectionSettingsChange,
	onReload,
	onResetSource,
	isResetting,
}: ProjectionConfigSidebarProps) {
	return (
		<div className="space-y-4">
			<SimulationSettingsCard
				projectionSettings={projectionSettings}
				projectionStartDate={projectionStartDate}
				currentChangeCount={currentChangeCount}
				onChange={onProjectionSettingsChange}
			/>

			<StochasticControls
				hasStochasticAccounts={hasStochasticAccounts}
				stochasticResult={stochasticResult}
				isRunning={isStochasticRunning}
				progress={stochasticProgress}
			/>

			<ModelAssumptionsCard
				document={document}
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
