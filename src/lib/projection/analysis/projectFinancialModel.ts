import { evaluationRegistry } from "../evaluation/registry";
import { EvaluationRuntimeSet } from "../evaluation/runtime";
import { projectRawFinancialModelDocument } from "../simulation/projectPath";
import type {
	FinancialModelDocument,
	ModelOverrides,
	ProjectionResult,
	ProjectionRuntimeSettings,
} from "../types/model";
import type { MonteCarloSample } from "../types/simulation";

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
	const runtimes = new EvaluationRuntimeSet(
		projectionSettings.evaluations,
		evaluationRegistry,
	);
	runtimes.evaluateDeterministic({
		path: raw.path,
		document: raw.path.effectiveDocument,
		monteCarloSample,
	});

	return { ...raw.result, ...runtimes.result() };
}
