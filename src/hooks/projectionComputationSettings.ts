import type { ProjectionRuntimeSettings } from "@/lib/projection";
import { canonicalSerialize } from "@/lib/projection/artifacts";
import { projectionComputationSettings } from "@/lib/projection/runtime/computationIdentity";

export {
	labelProjectionResult,
	labelStochasticResult,
} from "@/lib/projection/runtime/resultLabels";

export function projectionComputationSettingsKey(
	settings: ProjectionRuntimeSettings,
) {
	return canonicalSerialize(projectionComputationSettings(settings));
}
