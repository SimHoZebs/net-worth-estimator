import {
	IndexedDbProjectionArtifactStore,
	type ProjectionArtifactStore,
} from "@/lib/projection/artifacts";
import type {
	ProjectionComputationEngine,
	ProjectionEngine,
} from "@/lib/projection/runtime/ProjectionEngine";
import { CachedProjectionEngine } from "./CachedProjectionEngine";
import { WorkerProjectionEngine } from "./WorkerProjectionEngine";

export interface ApplicationProjectionEngineOptions {
	computationEngine?: ProjectionComputationEngine;
	artifactStore?: ProjectionArtifactStore;
}

export function createApplicationProjectionEngine(
	options: ApplicationProjectionEngineOptions = {},
): ProjectionEngine {
	return new CachedProjectionEngine(
		options.computationEngine ?? new WorkerProjectionEngine(),
		options.artifactStore ?? new IndexedDbProjectionArtifactStore(),
	);
}
