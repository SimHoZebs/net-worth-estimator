import { useRef, useState } from "react";
import type { FinancialModelDocument } from "../api/index.ts";
import { parseModelDocument } from "../api/modelImport.ts";
import { download, type Workspace } from "./storage.ts";
import { useFileReview } from "./useFileReview.ts";

export type ModelImportOptions = {
	workspace: Workspace;
	readOnly: boolean;
	serverDocument: FinancialModelDocument | null;
	onImportServerDocument: (
		document: FinancialModelDocument,
	) => Promise<boolean>;
};

// Owns the file-review interaction. Persistence and authoritative save state
// remain with the workspace callbacks supplied by the runtime container.
export function useModelImport({
	workspace,
	readOnly,
	serverDocument,
	onImportServerDocument,
}: ModelImportOptions) {
	const inputRef = useRef<HTMLInputElement>(null);
	const { candidate, error, reading, setError, readFile, clearCandidate } =
		useFileReview<FinancialModelDocument>({
			parse: (text) =>
				parseModelDocument({
					text,
					malformedMessage: "The selected server model file is not valid JSON.",
				}),
			oversizedMessage:
				"The server model file is larger than 2 MB. Choose a smaller JSON file.",
			blockedMessage: readOnly
				? "This server is read-only and cannot accept a model import."
				: null,
		});
	const [importing, setImporting] = useState(false);
	const exportServerModel = () => {
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
	};
	const exportWorkspace = () =>
		download({
			name: "waypoint-local-recovery.json",
			content: JSON.stringify(workspace, null, 2),
		});
	const importServerModel = async () => {
		if (!candidate || readOnly || workspace.draft) return;
		setImporting(true);
		setError(null);
		try {
			const imported = await onImportServerDocument(candidate);
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
		candidate,
		exportServerModel,
		exportWorkspace,
		onFile: readFile,
		importServerModel,
		closePreview: clearCandidate,
	};
}

export type ModelImportController = ReturnType<typeof useModelImport>;
