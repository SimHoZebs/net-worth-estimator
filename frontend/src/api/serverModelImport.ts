import * as errore from "errore";
import type { FinancialModelDocument } from "@/api/contracts.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { responseScopeError } from "@/api/scopedRequest.ts";
import { getFinancialModel } from "@/api/generated/endpoints.ts";
import {
	applyRowOperations,
	diffFinancialModelDocuments,
} from "@/api/rowSync.ts";

export const READ_ONLY_IMPORT_MESSAGE =
	"The server is read-only. The selected model was not uploaded.";

export class ServerModelImportError extends errore.createTaggedError({
	name: "ServerModelImportError",
	message: "$detail",
}) {}

export type ServerModelImportOptions = {
	preconditions: {
		hasWorkspace: boolean;
		readOnly: boolean;
		loading: boolean;
	};
	recover: (document: FinancialModelDocument) => Promise<boolean>;
	reload: () => Promise<void>;
};

// The recovery callback owns initial activation. Replacement diffs the
// reviewed document against the current server document and applies row
// operations, then reloads authoritative state.
export async function importServerModel({
	document,
	preconditions,
	recover,
	reload,
}: ServerModelImportOptions & {
	document: FinancialModelDocument;
}): Promise<boolean | Error> {
	const scope = getUserScope();
	if (!preconditions.hasWorkspace) return recover(document);
	if (preconditions.readOnly)
		return new ServerModelImportError({
			detail: READ_ONLY_IMPORT_MESSAGE,
		});
	if (preconditions.loading)
		return new ServerModelImportError({
			detail:
				"Wait for the current server operation to finish before importing a model.",
		});
	let current: FinancialModelDocument | null;
	try {
		current = (await getFinancialModel()).data
			.document as FinancialModelDocument | null;
	} catch (cause) {
		return cause instanceof Error ? cause : new Error(String(cause));
	}
	const stale = responseScopeError(scope);
	if (stale) return stale;
	const operations = diffFinancialModelDocuments(current, document);
	const applied = await applyRowOperations(operations);
	const changed = responseScopeError(scope);
	if (changed) return changed;
	if (applied instanceof Error) return applied;
	if (!applied.ok) {
		const details = applied.issues
			.filter((issue) => issue.severity === "error")
			.map((issue) => issue.message)
			.filter(Boolean)
			.join(" ");
		return new ServerModelImportError({
			detail: `The server rejected this model${details ? `: ${details}` : "."}`,
		});
	}
	await reload();
	return responseScopeError(scope) ?? true;
}
