import { evaluationRegistry } from "../evaluation/registry";
import { EvaluationRuntimeSet } from "../evaluation/runtime";
import { projectRawScenarioPack } from "../simulation/projectPath";
import type {
	ProjectionResult,
	ProjectionRuntimeSettings,
	ScenarioPack,
	ScenarioWhatIfState,
} from "../types/scenario";

export function projectScenarioPack(
	pack: ScenarioPack,
	projectionSettings: ProjectionRuntimeSettings,
	whatIfState?: ScenarioWhatIfState,
	stochasticRates?: Map<string, number[]>,
): ProjectionResult {
	const raw = projectRawScenarioPack(
		pack,
		projectionSettings,
		whatIfState,
		stochasticRates,
	);
	const runtimes = new EvaluationRuntimeSet(
		projectionSettings.evaluations,
		evaluationRegistry,
	);
	runtimes.evaluateDeterministic({
		path: raw.path,
		scenario: raw.path.effectivePack,
		stochasticRates,
	});

	return { ...raw.result, ...runtimes.result() };
}
