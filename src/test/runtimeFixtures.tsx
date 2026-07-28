import type { ReactNode } from "react";
import {
	type ModelRuntime,
	ModelRuntimeProvider,
} from "@/runtime/modelRuntime";
import {
	type ProjectionArtifacts,
	type ProjectionCapabilities,
	type ProjectionExecution,
	ProjectionRuntimeProvider,
} from "@/runtime/projectionRuntime";

export function createModelRuntimeFixture(
	overrides: Partial<ModelRuntime> = {},
): ModelRuntime {
	return {
		source: {
			label: "Test source",
			description: "Test financial model",
			sourceType: "test",
			saveLabel: "Save",
			resetLabel: "Reset",
		},
		document: null,
		effectiveDocument: null,
		issues: [],
		validationIsValid: true,
		loadError: null,
		sourceActionError: null,
		isLoading: false,
		isSourceUpdating: false,
		dataUpdatedAt: 0,
		projectionStartDate: "2026-01-31",
		isSaving: false,
		isResetting: false,
		reload: () => {},
		save: () => {},
		reset: () => {},
		applyTemplate: () => {},
		...overrides,
	};
}

export function createProjectionArtifactsFixture(
	overrides: Partial<ProjectionArtifacts> = {},
): ProjectionArtifacts {
	return {
		result: null,
		projectionResultIsStale: false,
		stochasticResult: null,
		stochasticResultIsStale: false,
		stochasticIsProvisional: false,
		currentMetrics: {
			currentNetWorth: 0,
			finalNetWorth: 0,
			evaluationOutcomes: [],
			currentChangeCount: 0,
		},
		...overrides,
	};
}

export function createProjectionExecutionFixture(
	overrides: Partial<ProjectionExecution> = {},
): ProjectionExecution {
	return {
		runtimeError: null,
		isProjecting: false,
		stochasticError: null,
		isStochasticRunning: false,
		...overrides,
	};
}

export function createProjectionCapabilitiesFixture(
	overrides: Partial<ProjectionCapabilities> = {},
): ProjectionCapabilities {
	return {
		hasStochasticAccounts: false,
		hasStochasticResult: false,
		canCaptureComparison: true,
		...overrides,
	};
}

export function RuntimeFixtureProviders({
	children,
	model,
	artifacts,
	execution,
	capabilities,
	stochasticProgress = null,
}: {
	children: ReactNode;
	model?: Partial<ModelRuntime>;
	artifacts?: Partial<ProjectionArtifacts>;
	execution?: Partial<ProjectionExecution>;
	capabilities?: Partial<ProjectionCapabilities>;
	stochasticProgress?: number | null;
}) {
	return (
		<ModelRuntimeProvider value={createModelRuntimeFixture(model)}>
			<ProjectionRuntimeProvider
				artifacts={createProjectionArtifactsFixture(artifacts)}
				execution={createProjectionExecutionFixture(execution)}
				capabilities={createProjectionCapabilitiesFixture(capabilities)}
				stochasticProgress={stochasticProgress}
			>
				{children}
			</ProjectionRuntimeProvider>
		</ModelRuntimeProvider>
	);
}
