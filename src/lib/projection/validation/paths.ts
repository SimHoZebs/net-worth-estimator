import {
	CSV_BEHAVIOR_FILE_NAMES,
	CSV_MODEL_FILE_NAMES,
	EVALUATION_TYPE_ORDER,
	type EvaluationType,
} from "../types/model";
import type { ValidationPaths } from "./types";

function append(path: readonly (string | number)[], field?: string) {
	return field === undefined ? [...path] : [...path, field];
}

export const modelValidationPaths: ValidationPaths = {
	account: (index, field) => append(["accounts", index], field),
	posting: (index, field) => append(["postings", index], field),
	postings: () => ["postings"],
	evaluation: (type, index) =>
		index === undefined ? ["evaluations", type] : ["evaluations", type, index],
};

export const csvValidationPaths: ValidationPaths = {
	account: (index, field) =>
		append([CSV_MODEL_FILE_NAMES.accounts, index + 2], field),
	posting: (index, field) =>
		append([CSV_MODEL_FILE_NAMES.postings, index + 2], field),
	postings: () => [CSV_MODEL_FILE_NAMES.postings],
	evaluation: (type: EvaluationType, index) =>
		index === undefined
			? [CSV_BEHAVIOR_FILE_NAMES[type]]
			: [CSV_BEHAVIOR_FILE_NAMES[type], index + 2],
};

export function evaluationTypes(): readonly EvaluationType[] {
	return EVALUATION_TYPE_ORDER;
}
