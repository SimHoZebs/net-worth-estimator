import type { Account, Transaction } from "../domain/model.ts";
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
	projection: Projection | null;
	pin?: EvaluationPin | null;
	range?: RangeResult | null;
	accounts: Account[];
	transactions: Transaction[];
	startDate: string;
}
