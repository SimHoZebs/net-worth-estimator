import * as errore from "errore";
import type { ApiClient } from "./client.ts";
import type { FinancialModelDocument } from "./contracts.ts";
import { getResourceScope } from "../auth/resourceScope.ts";
import { responseScopeError } from "./scopedRequest.ts";
import {
	applyRowOperations,
	diffFinancialModelDocuments,
	type RowWriter,
} from "./rowSync.ts";

export const READ_ONLY_IMPORT_MESSAGE =
	"The server is read-only. The selected model was not uploaded.";

export class ServerModelImportError extends errore.createTaggedError({
	name: "ServerModelImportError",
	message: "$detail",
}) {}

export type ServerModelImportOptions = {
	client: Pick<ApiClient, "getModel"> & RowWriter;
	preconditions: {
		hasWorkspace: boolean;
		readOnly: boolean;
		hasDraft: boolean;
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
	client,
	preconditions,
	recover,
	reload,
}: ServerModelImportOptions & { document: FinancialModelDocument }): Promise<
	boolean | Error
> {
	const scope = getResourceScope();
	if (!preconditions.hasWorkspace) return recover(document);
	if (preconditions.readOnly)
		return new ServerModelImportError({
			detail: READ_ONLY_IMPORT_MESSAGE,
		});
	if (preconditions.hasDraft)
		return new ServerModelImportError({
			detail:
				"Save or discard your temporary server plan before importing another model.",
		});
	if (preconditions.loading)
		return new ServerModelImportError({
			detail:
				"Wait for the current server operation to finish before importing a model.",
		});
	const current = await client.getModel();
	const stale = responseScopeError(scope);
	if (stale) return stale;
	if (current instanceof Error) return current;
	const operations = diffFinancialModelDocuments(current.document, document);
	const applied = await applyRowOperations(client, operations);
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
