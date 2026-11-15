import { useMutation } from "@tanstack/react-query";
import type { FinancialModel } from "../api/contracts.ts";
import { responseScopeError } from "../api/scopedRequest.ts";
import { getUserScope } from "../auth/resourceScope.ts";
import {
	importServerModel,
	type ServerModelImportOptions,
} from "../api/serverModelImport.ts";
import { serverQueryClient } from "./serverQuery.ts";

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
	const importModel = async (model: FinancialModel): Promise<boolean> => {
		const stale = responseScopeError(scope);
		if (stale) throw stale;
		return mutation.mutateAsync(model);
	};
	return { importModel };
}
