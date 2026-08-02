import type { IncomeDataSnapshot } from "../../types/income";
import type { FinancialModelDocument } from "../../types/model";
import { csvValidationPaths } from "../../validation/paths";
import {
	summarizeValidationIssues,
	validateFinancialModel,
} from "../../validation/validateFinancialModel";

/**
 * Adapts source-neutral model validation to the CSV/API diagnostic path format.
 */
export function validateCsvFinancialModel(
	document: FinancialModelDocument,
	incomeData?: IncomeDataSnapshot,
) {
	return validateFinancialModel(document, {
		incomeData,
		paths: csvValidationPaths,
	});
}

export { summarizeValidationIssues };
