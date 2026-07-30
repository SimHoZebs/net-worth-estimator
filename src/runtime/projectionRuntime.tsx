import { createContext, type ReactNode, useContext } from "react";
import type {
	ProjectionResult,
	StochasticProgress,
	StochasticProjectionResult,
} from "@/lib/projection";
import type { ComparisonMetrics } from "@/store";

export interface ProjectionArtifacts {
	result: ProjectionResult | null;
	projectionResultIsStale: boolean;
	stochasticResult: StochasticProjectionResult | null;
	stochasticResultIsStale: boolean;
	stochasticIsProvisional: boolean;
	currentMetrics: ComparisonMetrics;
}

export interface ProjectionExecution {
	runtimeError: string | null;
	isProjecting: boolean;
	stochasticError: string | null;
	isStochasticRunning: boolean;
}

export interface ProjectionCapabilities {
	hasStochasticAccounts: boolean;
	hasStochasticResult: boolean;
	canCaptureComparison: boolean;
}

const ProjectionArtifactsContext = createContext<ProjectionArtifacts | null>(
	null,
);
const ProjectionExecutionContext = createContext<ProjectionExecution | null>(
	null,
);
const ProjectionCapabilitiesContext =
	createContext<ProjectionCapabilities | null>(null);
const StochasticProgressContext = createContext<
	StochasticProgress | null | undefined
>(undefined);

export function ProjectionRuntimeProvider({
	artifacts,
	execution,
	capabilities,
	stochasticProgress,
	children,
}: {
	artifacts: ProjectionArtifacts;
	execution: ProjectionExecution;
	capabilities: ProjectionCapabilities;
	stochasticProgress: StochasticProgress | null;
	children: ReactNode;
}) {
	return (
		<ProjectionArtifactsContext.Provider value={artifacts}>
			<ProjectionCapabilitiesContext.Provider value={capabilities}>
				<StochasticProgressContext.Provider value={stochasticProgress}>
					<ProjectionExecutionContext.Provider value={execution}>
						{children}
					</ProjectionExecutionContext.Provider>
				</StochasticProgressContext.Provider>
			</ProjectionCapabilitiesContext.Provider>
		</ProjectionArtifactsContext.Provider>
	);
}

export function useProjectionArtifacts() {
	const runtime = useContext(ProjectionArtifactsContext);
	if (!runtime) {
		throw new Error(
			"useProjectionArtifacts requires ProjectionRuntimeProvider.",
		);
	}
	return runtime;
}

export function useProjectionExecution() {
	const runtime = useContext(ProjectionExecutionContext);
	if (!runtime) {
		throw new Error(
			"useProjectionExecution requires ProjectionRuntimeProvider.",
		);
	}
	return runtime;
}

export function useProjectionCapabilities() {
	const runtime = useContext(ProjectionCapabilitiesContext);
	if (!runtime) {
		throw new Error(
			"useProjectionCapabilities requires ProjectionRuntimeProvider.",
		);
	}
	return runtime;
}

export function useStochasticProgress() {
	const progress = useContext(StochasticProgressContext);
	if (progress === undefined) {
		throw new Error(
			"useStochasticProgress requires ProjectionRuntimeProvider.",
		);
	}
	return progress;
}
