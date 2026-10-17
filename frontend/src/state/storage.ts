import * as errore from "errore";
import { z } from "zod";
import { type Plan, planSchema } from "../domain/model.ts";

export class StorageError extends errore.createTaggedError({
	name: "StorageError",
	message:
		"$detail Your saved plan has not been replaced. Export your work, then retry.",
}) {}
export class ImportError extends errore.createTaggedError({
	name: "ImportError",
	message: "$detail Choose a valid Waypoint plan JSON file.",
}) {}

function migrateLegacySnapshot(value: unknown): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return value;
	const record = value as Record<string, unknown>;
	if (
		record.evaluationDate === undefined &&
		typeof record.goalDate !== "undefined"
	)
		return { ...record, evaluationDate: record.goalDate };
	return value;
}

export const snapshotSchema = z.preprocess(
	migrateLegacySnapshot,
	z.object({
		capturedAt: z.string(),
		name: z.string(),
		years: z.number(),
		startDate: z.string(),
		revision: z.number(),
		assumptions: z.string(),
		// Legacy derived metrics. Old captures stored these; new captures omit
		// them and derive previous/current at render via comparisonMetrics.
		final: z.number().optional(),
		current: z.number().optional(),
		evaluationDate: z.string().nullable().optional(),
		shortfallDate: z.string().nullable().optional(),
		changes: z.number().optional(),
	}),
);
export type Snapshot = z.infer<typeof snapshotSchema>;
// Workspace persistence lives in remoteStorage.ts (REMOTE_STORAGE_KEY).
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

export function download({
	name,
	content,
	type = "application/json",
}: {
	name: string;
	content: string;
	type?: string;
}) {
	const url = URL.createObjectURL(new Blob([content], { type }));
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = name;
	anchor.click();
	window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
