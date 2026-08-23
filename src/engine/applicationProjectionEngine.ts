import { InMemoryProjectionArtifactStore } from "@/lib/projection/artifacts";
import type {
	ProjectionComputationEngine,
	ProjectionEngine,
} from "@/lib/projection/runtime/ProjectionEngine";
import { BackendProjectionEngine } from "./BackendProjectionEngine";
import { CachedProjectionEngine } from "./CachedProjectionEngine";

export interface ApplicationProjectionEngineOptions {
	computationEngine?: ProjectionComputationEngine;
	artifactStore?: import("@/lib/projection/artifacts").ProjectionArtifactStore;
}

// Computation runs in the Go backend; the client keeps an in-memory cache so
// navigation does not refetch unchanged projections. Durable artifact storage
// moved server-side (ASSUMPTIONS A2/D3).
export function createApplicationProjectionEngine(
	options: ApplicationProjectionEngineOptions = {},
): ProjectionEngine {
	return new CachedProjectionEngine(
		options.computationEngine ?? new BackendProjectionEngine(),
		options.artifactStore ?? new InMemoryProjectionArtifactStore(),
	);
}
