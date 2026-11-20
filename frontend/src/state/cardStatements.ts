import { useQuery } from "@tanstack/react-query";
import {
	listCardStatements,
	listTransactionStatementPaymentSuggestions,
} from "@/api/generated/endpoints.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { serverQueryClient } from "./serverQuery.ts";
import { useUserScope } from "./useUserScope.ts";

const cardStatementKey = (scopeKey: string) =>
	["user-resources", scopeKey, "card-statements"] as const;

export function useCardStatements(accountId: string) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: [...cardStatementKey(scope.key), "account", accountId],
			queryFn: async ({ signal }) =>
				(await listCardStatements({ accountId }, { signal })).data.statements ??
				[],
			enabled: scope.status === "ready",
		},
		serverQueryClient(),
	);
}

export function refreshCardStatements(scope = getUserScope()) {
	return serverQueryClient().invalidateQueries({
		queryKey: cardStatementKey(scope.key),
	});
}

export function useStatementPaymentSuggestions(
	transactionId: string,
	enabled: boolean,
) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: [...cardStatementKey(scope.key), "transaction", transactionId],
			queryFn: async ({ signal }) =>
				(
					await listTransactionStatementPaymentSuggestions(transactionId, {
						signal,
					})
				).data,
			enabled: enabled && scope.status === "ready",
			retry: false,
		},
		serverQueryClient(),
	);
}
