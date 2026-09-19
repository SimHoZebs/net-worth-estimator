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

interface ProjectionRuntimeValue {
	artifacts: ProjectionArtifacts;
	execution: ProjectionExecution;
	capabilities: ProjectionCapabilities;
	stochasticProgress: StochasticProgress | null;
}

// One narrow context for the whole projection runtime. The four consumer
// hooks below are selectors over it, so components keep their imports while
// the provider tree stays flat.
const ProjectionRuntimeContext = createContext<ProjectionRuntimeValue | null>(
	null,
);

export function ProjectionRuntimeProvider({
	artifacts,
	execution,
	capabilities,
	stochasticProgress,
	children,
}: ProjectionRuntimeValue & {
	children: ReactNode;
}) {
	return (
		<ProjectionRuntimeContext.Provider
			value={{ artifacts, execution, capabilities, stochasticProgress }}
		>
			{children}
		</ProjectionRuntimeContext.Provider>
	);
}

function useProjectionRuntime() {
	const runtime = useContext(ProjectionRuntimeContext);
	if (!runtime) {
		throw new Error("useProjectionRuntime requires ProjectionRuntimeProvider.");
	}
	return runtime;
}

export function useProjectionArtifacts() {
	return useProjectionRuntime().artifacts;
}

export function useProjectionExecution() {
	return useProjectionRuntime().execution;
}

export function useProjectionCapabilities() {
	return useProjectionRuntime().capabilities;
}

export function useStochasticProgress() {
	return useProjectionRuntime().stochasticProgress;
}
