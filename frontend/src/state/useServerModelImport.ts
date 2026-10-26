import type { FinancialModelDocument } from "../api/contracts.ts";
import { responseScopeError } from "../api/scopedRequest.ts";
import {
	getResourceScope,
	subscribeResourceScope,
} from "../auth/resourceScope.ts";
import {
	importServerModel,
	type ServerModelImportOptions,
} from "../api/serverModelImport.ts";
import { useUiStore } from "./uiStore.ts";

// A scope transition orphans any in-flight import on the old scope (its
// guarded requests abort and its finally skips the clear by design), so the
// shared flag resets on publish instead of sticking until reload. This does
// not restore the old unmount cleanup, which cleared the flag while a
// different import on the same scope was still running.
subscribeResourceScope(() => {
	useUiStore.getState().setImporting(false);
});

export function useServerModelImport(options: ServerModelImportOptions) {
	const scope = getResourceScope();
	// Single source of truth: the shared uiStore flag. The hook no longer
	// keeps a local copy that can drift or clear the global on unmount while
	// another importer runs. The flag clears in `importDocument`'s finally,
	// not on unmount.
	const importing = useUiStore((state) => state.importing);
	const setSharedImporting = useUiStore((state) => state.setImporting);
	const importDocument = async (
		document: FinancialModelDocument,
	): Promise<boolean> => {
		const stale = responseScopeError(scope);
		if (stale) throw stale;
		setSharedImporting(true);
		try {
			const result = await importServerModel({
				...options,
				document,
			});
			// Workspace callbacks expose failures as rejected promises to their views.
			if (result instanceof Error) throw result;
			return result;
		} finally {
			if (!responseScopeError(scope)) {
				setSharedImporting(false);
			}
		}
	};
	return { importing, importDocument };
}
