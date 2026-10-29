import * as errore from "errore";
import { type Plan, planSchema } from "../domain/model.ts";

export class StorageError extends errore.createTaggedError({
	name: "StorageError",
	message: "$detail Your changes were not saved. Retry.",
}) {}
export class ImportError extends errore.createTaggedError({
	name: "ImportError",
	message: "$detail Choose a valid Waypoint model JSON file.",
}) {}

// Drafts live in memory only. File import validates through planSchema below.
// Do not add another workspace schema here.
export function parsePlan(text: string): Plan | ImportError {
	const value = errore.try({
		try: () => JSON.parse(text) as object,
		catch: (cause) =>
			new ImportError({ detail: "This file is not valid JSON.", cause }),
	});
	if (value instanceof Error) return value;
	const parsed = planSchema.safeParse(value);
	if (!parsed.success)
		return new ImportError({
			detail: parsed.error.issues
				.slice(0, 5)
				.map((issue) => `${issue.path.join(".")}: ${issue.message}`)
				.join(" "),
			cause: parsed.error,
		});
	return parsed.data;
}
