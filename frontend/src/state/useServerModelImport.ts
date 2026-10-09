import { useState } from "react";
import { type ApiClient, createApiClient } from "../api/client.ts";
import type { FinancialModelDocument } from "../api/contracts.ts";
import {
	importServerModel,
	type ServerModelImportOptions,
} from "../api/serverModelImport.ts";
import { useUiStore } from "./uiStore.ts";

let defaultImportClient: Pick<ApiClient, "putModel"> | null = null;

function defaultClient(): Pick<ApiClient, "putModel"> {
	if (!defaultImportClient) defaultImportClient = createApiClient();
	return defaultImportClient;
}

export function useServerModelImport(
	options: Omit<ServerModelImportOptions, "client"> & {
		client?: ServerModelImportOptions["client"];
	},
) {
	const [importing, setImporting] = useState(false);
	const setSharedImporting = useUiStore((state) => state.setImporting);
	const importDocument = async (
		document: FinancialModelDocument,
	): Promise<boolean> => {
		setImporting(true);
		setSharedImporting(true);
		try {
			const result = await importServerModel({
				...options,
				client: options.client ?? defaultClient(),
				document,
			});
			// Workspace callbacks expose failures as rejected promises to their views.
			if (result instanceof Error) throw result;
			return result;
		} finally {
			setImporting(false);
			setSharedImporting(false);
		}
	};
	return { importing, importDocument };
}
