import type {
	IsoDate,
	ProjectionResult,
	ProjectionRuntimeSettings,
	ScenarioPack,
	ScenarioWhatIfState,
} from "../types/scenario";
import { evaluateFinancialIndependence } from "./financialIndependence";
import { evaluateNetWorthThreshold } from "./netWorthThreshold";
import { projectRawScenarioPack } from "./rawScenarioProject";

export function projectScenarioPack(
	pack: ScenarioPack,
	projectionSettings: ProjectionRuntimeSettings,
	whatIfState?: ScenarioWhatIfState,
	stochasticRates?: Map<string, number[]>,
	evaluationOptions?: { fiCandidateDates?: readonly IsoDate[] },
): ProjectionResult {
	const raw = projectRawScenarioPack(
		pack,
		projectionSettings,
		whatIfState,
		stochasticRates,
	);
	const netWorthThreshold = evaluateNetWorthThreshold(
		raw.path,
		projectionSettings.targetNetWorth,
	);

	return {
		...raw.result,
		financialIndependence: evaluateFinancialIndependence({
			path: raw.path,
			plan: projectionSettings.financialIndependencePlan,
			stochasticRates,
			candidateDates: evaluationOptions?.fiCandidateDates,
		}),
		milestones: {
			...raw.result.milestones,
			hitTargetDate: netWorthThreshold.firstReachedDate,
		},
	};
}
