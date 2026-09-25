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

export const snapshotSchema = z.object({
	capturedAt: z.string(),
	name: z.string(),
	years: z.number(),
	startDate: z.string(),
	final: z.number(),
	current: z.number(),
	goalDate: z.string().nullable(),
	shortfallDate: z.string().nullable(),
	revision: z.number(),
	changes: z.number(),
	assumptions: z.string(),
});
export type Snapshot = z.infer<typeof snapshotSchema>;
const workspaceSchema = z.object({
	version: z.literal(1),
	saved: planSchema,
	draft: planSchema.nullable(),
	snapshot: snapshotSchema.nullable(),
});
export type Workspace = z.infer<typeof workspaceSchema>;
export const STORAGE_KEY = "waypoint.workspace.v1";

export function loadWorkspace(): Workspace | StorageError | null {
	return errore.try({
		try: () => {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw === null) return null;
			const parsed = workspaceSchema.safeParse(JSON.parse(raw));
			if (!parsed.success)
				return new StorageError({
					detail: "Stored data could not be validated.",
					cause: parsed.error,
				});
			return parsed.data;
		},
		catch: (cause) =>
			new StorageError({ detail: "Browser storage could not be read.", cause }),
	});
}

export function persistWorkspace(
	workspace: Workspace,
	expected?: string | null,
): StorageError | null {
	return errore.try({
		try: () => {
			if (
				expected !== undefined &&
				localStorage.getItem(STORAGE_KEY) !== expected
			)
				return new StorageError({
					detail:
						"This workspace was changed in another tab. Export your temporary work, then reload the latest saved plan.",
				});
			localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
			return null;
		},
		catch: (cause) =>
			new StorageError({
				detail: "This browser could not store your work.",
				cause,
			}),
	});
}

export function readStoredWorkspace(): string | StorageError | null {
	return errore.try({
		try: () => localStorage.getItem(STORAGE_KEY),
		catch: (cause) =>
			new StorageError({
				detail: "The stored workspace could not be read.",
				cause,
			}),
	});
}

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
