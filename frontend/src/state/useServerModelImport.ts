import { useState } from "react";
import type { FinancialModelDocument } from "../api/contracts.ts";
import {
	importServerModel,
	type ServerModelImportOptions,
} from "../api/serverModelImport.ts";

export function useServerModelImport(options: ServerModelImportOptions) {
	const [importing, setImporting] = useState(false);
	const importDocument = async (
		document: FinancialModelDocument,
	): Promise<boolean> => {
		setImporting(true);
		try {
			const result = await importServerModel({ ...options, document });
			// Workspace callbacks expose failures as rejected promises to their views.
			if (result instanceof Error) throw result;
			return result;
		} finally {
			setImporting(false);
		}
	};
	return { importing, importDocument };
}
