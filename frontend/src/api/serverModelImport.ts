import * as errore from "errore";
import type { FinancialModel } from "@/api/contracts.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { responseScopeError } from "@/api/scopedRequest.ts";
import { importModel } from "@/api/generated/endpoints.ts";

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
	recover: (model: FinancialModel) => Promise<boolean>;
	reload: () => Promise<void>;
};

// The server owns the import diff: authored fields come from the document,
// stored lifecycle state stays in place, and row order follows the document.
// The client sends one document and reloads authoritative state.
export async function importServerModel({
	model,
	preconditions,
	recover,
	reload,
}: ServerModelImportOptions & {
	model: FinancialModel;
}): Promise<boolean | Error> {
	const scope = getUserScope();
	if (!preconditions.hasWorkspace) return recover(model);
	if (preconditions.readOnly)
		return new ServerModelImportError({
			detail: READ_ONLY_IMPORT_MESSAGE,
		});
	if (preconditions.loading)
		return new ServerModelImportError({
			detail:
				"Wait for the current server operation to finish before importing a model.",
		});
	let applied: Awaited<ReturnType<typeof importModel>>;
	try {
		applied = await importModel({ model: model as never });
	} catch (cause) {
		return cause instanceof Error ? cause : new Error(String(cause));
	}
	const changed = responseScopeError(scope);
	if (changed) return changed;
	if (!applied.data.saved) {
		const details = (applied.data.issues ?? [])
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
