import * as errore from "errore";
import type { FinancialModelDocument } from "./index.ts";

export class ModelImportError extends errore.createTaggedError({
	name: "ModelImportError",
	message: "$detail",
}) {}

export const MAX_IMPORT_BYTES = 2_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isEvaluationTables(value: unknown): boolean {
	return (
		isRecord(value) &&
		Array.isArray(value.financialIndependence) &&
		Array.isArray(value.netWorthThreshold) &&
		Array.isArray(value.postingFulfillment)
	);
}

// Import preview checks only the envelope and displayed records. The server
// remains responsible for authoritative cross-field validation before activation.
export function isFinancialModelDocument(
	value: unknown,
): value is FinancialModelDocument {
	if (
		!isRecord(value) ||
		typeof value.sourcePath !== "string" ||
		!isEvaluationTables(value.evaluations)
	)
		return false;
	if (
		!Array.isArray(value.accounts) ||
		!Array.isArray(value.checkpoints) ||
		!Array.isArray(value.postings)
	)
		return false;
	const accountsValid = value.accounts.every(
		(item) =>
			isRecord(item) &&
			typeof item.id === "string" &&
			typeof item.label === "string" &&
			typeof item.enabled === "boolean",
	);
	const checkpointsValid = value.checkpoints.every(
		(item) =>
			isRecord(item) &&
			typeof item.Date === "string" &&
			typeof item.AccountId === "string" &&
			typeof item.Balance === "number",
	);
	const postingsValid = value.postings.every(
		(item) =>
			isRecord(item) &&
			typeof item.id === "string" &&
			typeof item.label === "string" &&
			typeof item.enabled === "boolean",
	);
	return accountsValid && checkpointsValid && postingsValid;
}

export function parseModelDocument({
	text,
	malformedMessage,
}: {
	text: string;
	malformedMessage: string;
}): FinancialModelDocument | ModelImportError {
	return errore.try({
		try: () => {
			const value: unknown = JSON.parse(text);
			if (!isFinancialModelDocument(value))
				return new ModelImportError({
					detail:
						"Choose a Waypoint server model JSON file with accounts, checkpoints, postings, and evaluations.",
				});
			return value;
		},
		catch: (cause) => new ModelImportError({ detail: malformedMessage, cause }),
	});
}

export async function readImportFile({
	file,
	oversizedMessage,
}: {
	file: Pick<File, "size" | "text">;
	oversizedMessage: string;
}): Promise<string | ModelImportError> {
	if (file.size > MAX_IMPORT_BYTES)
		return new ModelImportError({ detail: oversizedMessage });
	return file.text().catch(
		(cause) =>
			new ModelImportError({
				detail: "The selected file could not be read.",
				cause,
			}),
	);
}
