import { useMutation } from "@tanstack/react-query";
import type { FinancialModel } from "../api/contracts.ts";
import { responseScopeError } from "../api/scopedRequest.ts";
import { getUserScope, subscribeUserScope } from "../auth/resourceScope.ts";
import {
	importServerModel,
	type ServerModelImportOptions,
} from "../api/serverModelImport.ts";
import { useUiStore } from "./uiStore.ts";
import { serverQueryClient } from "./serverQuery.ts";

// A scope transition orphans any in-flight import on the old scope (its
// guarded requests abort and its finally skips the clear by design), so the
// shared flag resets on publish instead of sticking until reload. This does
// not restore the old unmount cleanup, which cleared the flag while a
// different import on the same scope was still running.
subscribeUserScope(() => {
	useUiStore.getState().setImporting(false);
});

export function useServerModelImport(options: ServerModelImportOptions) {
	const scope = getUserScope();
	const mutation = useMutation(
		{
			mutationKey: ["server-model-import", scope.key],
			retry: false,
			gcTime: 0,
			mutationFn: async (model: FinancialModel) => {
				const stale = responseScopeError(scope);
				if (stale) throw stale;
				const result = await importServerModel({ ...options, model });
				if (result instanceof Error) throw result;
				return result;
			},
		},
		serverQueryClient(),
	);
	// Single source of truth: the shared uiStore flag. The hook no longer
	// keeps a local copy that can drift or clear the global on unmount while
	// another importer runs. The flag clears in `importModel`'s finally,
	// not on unmount.
	const importing = useUiStore((state) => state.importing);
	const setSharedImporting = useUiStore((state) => state.setImporting);
	const importModel = async (model: FinancialModel): Promise<boolean> => {
		const stale = responseScopeError(scope);
		if (stale) throw stale;
		setSharedImporting(true);
		try {
			return await mutation.mutateAsync(model);
		} finally {
			if (!responseScopeError(scope)) {
				setSharedImporting(false);
			}
		}
	};
	return { importing, importModel };
}
