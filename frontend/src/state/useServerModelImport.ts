import { useEffect, useMemo, useState } from "react";
import { createApiClient } from "../api/client.ts";
import type { FinancialModelDocument } from "../api/contracts.ts";
import {
	resourceScopedFactory,
	responseScopeError,
} from "../api/scopedRequest.ts";
import { getResourceScope } from "../auth/resourceScope.ts";
import {
	importServerModel,
	type ServerModelImportOptions,
} from "../api/serverModelImport.ts";
import { useUiStore } from "./uiStore.ts";

const defaultClient = resourceScopedFactory(createApiClient);

export function useServerModelImport(
	options: Omit<ServerModelImportOptions, "client"> & {
		client?: ServerModelImportOptions["client"];
	},
) {
	const [importing, setImporting] = useState(false);
	const scope = getResourceScope();
	const api = useMemo(
		() => options.client ?? defaultClient(),
		[options.client],
	);
	const setSharedImporting = useUiStore((state) => state.setImporting);
	useEffect(() => () => setSharedImporting(false), [setSharedImporting]);
	const importDocument = async (
		document: FinancialModelDocument,
	): Promise<boolean> => {
		const stale = responseScopeError(scope);
		if (stale) throw stale;
		setImporting(true);
		setSharedImporting(true);
		try {
			const result = await importServerModel({
				...options,
				client: api,
				document,
			});
			// Workspace callbacks expose failures as rejected promises to their views.
			if (result instanceof Error) throw result;
			return result;
		} finally {
			if (!responseScopeError(scope)) {
				setImporting(false);
				setSharedImporting(false);
			}
		}
	};
	return { importing, importDocument };
}
