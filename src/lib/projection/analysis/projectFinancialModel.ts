import { evaluationRegistry } from "../evaluation/registry";
import { EvaluationRuntimeSet } from "../evaluation/runtime";
import { projectRawFinancialModelDocument } from "../simulation/projectPath";
import type {
	EvaluationResultCollection,
	EvaluationTables,
	FinancialModelDocument,
	ModelOverrides,
	ProjectionPath,
	ProjectionResult,
	ProjectionRuntimeSettings,
} from "../types/model";
import type { MonteCarloSample } from "../types/simulation";

export function evaluateProjectionPath(
	path: ProjectionPath,
	evaluations: EvaluationTables,
	options: {
		monteCarloSample?: MonteCarloSample;
		detailLevel?: "detailed" | "summary";
	} = {},
): EvaluationResultCollection {
	const runtimes = new EvaluationRuntimeSet(evaluations, evaluationRegistry);
	runtimes.evaluateDeterministic({
		path,
		document: path.effectiveDocument,
		...options,
	});
	return runtimes.result();
}

export function projectFinancialModelDocument(
	document: FinancialModelDocument,
	projectionSettings: ProjectionRuntimeSettings,
	overrides?: ModelOverrides,
	monteCarloSample?: MonteCarloSample,
): ProjectionResult {
	const raw = projectRawFinancialModelDocument(
		document,
		projectionSettings,
		overrides,
		monteCarloSample,
	);
	return {
		...raw.result,
		...evaluateProjectionPath(raw.path, projectionSettings.evaluations, {
			monteCarloSample,
		}),
	};
}
