import * as errore from "errore";
import { type ApiClient, ApiHttpError } from "./client.ts";
import type { FinancialModelDocument } from "./contracts.ts";

export class ServerModelImportError extends errore.createTaggedError({
	name: "ServerModelImportError",
	message: "$detail",
}) {}

export type ServerModelImportOptions = {
	client: Pick<ApiClient, "putModel">;
	authToken: string;
	preconditions: {
		hasWorkspace: boolean;
		readOnly: boolean;
		hasDraft: boolean;
		loading: boolean;
		revision: string | null;
	};
	recover: (document: FinancialModelDocument) => Promise<boolean>;
	reload: () => Promise<void>;
};

// The recovery callback owns initial activation. Replacement uses the reviewed
// revision and reloads authoritative state after success or a stale revision.
export async function importServerModel({
	document,
	client,
	authToken,
	preconditions,
	recover,
	reload,
}: ServerModelImportOptions & { document: FinancialModelDocument }): Promise<
	boolean | Error
> {
	if (!preconditions.hasWorkspace) return recover(document);
	if (preconditions.readOnly)
		return new ServerModelImportError({
			detail: "The server is read-only. The selected model was not uploaded.",
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
	if (!preconditions.revision)
		return new ServerModelImportError({
			detail:
				"The server did not provide a model content identity. Reload the current model before importing.",
		});
	const result = await client.putModel(document, {
		authToken,
		ifMatch: preconditions.revision,
	});
	if (result instanceof Error) {
		if (result instanceof ApiHttpError && result.status === 412) {
			await reload();
			return new ServerModelImportError({
				detail:
					"The server model changed while this import was being reviewed. The latest model has been loaded; review it before importing again.",
				cause: result,
			});
		}
		return result;
	}
	const validationErrors = result.issues.filter(
		(issue) => issue.severity === "error",
	);
	if (validationErrors.length) {
		const details = validationErrors
			.map((issue) => issue.message)
			.filter(Boolean)
			.join(" ");
		return new ServerModelImportError({
			detail: `The server rejected this model${details ? `: ${details}` : "."}`,
		});
	}
	await reload();
	return true;
}
