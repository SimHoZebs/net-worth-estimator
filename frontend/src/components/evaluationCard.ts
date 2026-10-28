import type { Plan } from "../domain/model.ts";
import type {
	OtherEvaluation,
	Projection,
	RangeResult,
} from "../domain/result.ts";

export type EvaluationPin = {
	pinned: boolean;
	onPinChange: (() => void) | null;
	disabled?: boolean;
};

export interface OtherEvaluationCardProps {
	item: OtherEvaluation;
	plan: Plan;
	projection: Projection | null;
	pin?: EvaluationPin | null;
	range?: RangeResult | null;
}
