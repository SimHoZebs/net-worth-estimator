import * as errore from "errore";
import { useRef, useState } from "react";
import type { FinancialModelDocument } from "../api/index.ts";
import { parseModelDocument } from "../api/modelImport.ts";
import type { Plan } from "../domain/model.ts";
import { download, ImportError, parsePlan, type Workspace } from "./storage.ts";
import { useFileReview } from "./useFileReview.ts";

type ImportCandidate =
	| { kind: "plan"; document: Plan }
	| { kind: "server"; document: FinancialModelDocument };

export type ModelImportOptions = {
	plan: Plan;
	workspace: Workspace;
	onReplace: (plan: Plan) => boolean;
	serverMode: boolean;
	readOnly: boolean;
	serverDocument: FinancialModelDocument | null;
	onImportServerDocument?: (
		document: FinancialModelDocument,
	) => Promise<boolean>;
};

// Owns the file-review interaction. Persistence and authoritative save state
// remain with the workspace callbacks supplied by the runtime container.
export function useModelImport({
	plan,
	workspace,
	onReplace,
	serverMode,
	readOnly,
	serverDocument,
	onImportServerDocument,
}: ModelImportOptions) {
	const inputRef = useRef<HTMLInputElement>(null);
	const { candidate, error, reading, setError, readFile, clearCandidate } =
		useFileReview<ImportCandidate>({
			parse: (text) => {
				if (serverMode) {
					const document = parseModelDocument({
						text,
						malformedMessage:
							"The selected server model file is not valid JSON.",
					});
					if (document instanceof Error) return document;
					return { kind: "server", document };
				}
				const document = parsePlan(text);
				if (document instanceof Error) return document;
				return { kind: "plan", document };
			},
			oversizedMessage: serverMode
				? "The server model file is larger than 2 MB. Choose a smaller JSON file."
				: "The plan file is larger than 2 MB. Choose a smaller Waypoint JSON export.",
			blockedMessage:
				serverMode && readOnly
					? "This server is read-only and cannot accept a model import."
					: null,
		});
	const [importing, setImporting] = useState(false);
	const planCandidate = candidate?.kind === "plan" ? candidate.document : null;
	const serverCandidate =
		candidate?.kind === "server" ? candidate.document : null;
	const exportPlan = () => {
		if (serverMode) {
			if (!serverDocument) {
				setError(
					"The canonical server model is not available. Retry the server load before exporting.",
				);
				return;
			}
			download({
				name: "waypoint-server-model.json",
				content: JSON.stringify(serverDocument, null, 2),
			});
			return;
		}
		download({
			name: `waypoint-${workspace.draft ? "temporary" : "saved"}-plan.json`,
			content: JSON.stringify(plan, null, 2),
		});
	};
	const exportWorkspace = () =>
		download({
			name: serverMode
				? "waypoint-local-recovery.json"
				: "waypoint-workspace-backup.json",
			content: JSON.stringify(workspace, null, 2),
		});
	const applyPlan = () => {
		if (!planCandidate) return;
		const result = errore.try({
			try: () => onReplace(planCandidate),
			catch: (cause) =>
				new ImportError({ detail: "The plan could not be applied.", cause }),
		});
		if (result instanceof Error) {
			setError(result.message);
			return;
		}
		if (result) clearCandidate();
	};
	const importServerModel = async () => {
		if (
			!serverCandidate ||
			!onImportServerDocument ||
			readOnly ||
			workspace.draft
		)
			return;
		setImporting(true);
		setError(null);
		try {
			const imported = await onImportServerDocument(serverCandidate);
			if (imported) clearCandidate();
			else
				setError(
					"The server did not activate this model. Review the server response before trying again.",
				);
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The server model could not be imported. The active model was not changed.",
			);
		} finally {
			setImporting(false);
		}
	};
	return {
		inputRef,
		error,
		reading,
		importing,
		planCandidate,
		serverCandidate,
		exportPlan,
		exportWorkspace,
		onFile: readFile,
		applyPlan,
		importServerModel,
		closePreview: clearCandidate,
	};
}

export type ModelImportController = ReturnType<typeof useModelImport>;
