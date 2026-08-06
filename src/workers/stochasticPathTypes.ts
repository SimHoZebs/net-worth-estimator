import type { ProjectionPath } from "@/lib/projection/types/model";
import type {
	MonteCarloSample,
	PreparedProjection,
} from "@/lib/projection/types/simulation";

export type StochasticPathWorkerRequest =
	| { type: "initialize"; prepared: PreparedProjection }
	| { type: "run"; runIndex: number; sample: MonteCarloSample };

export type StochasticPathWorkerResponse =
	| { type: "ready" }
	| { type: "result"; runIndex: number; path: ProjectionPath }
	| { type: "error"; runIndex: number | null; message: string };
