import { useMutation, useQuery } from "@tanstack/react-query";
import {
	attachReceipt,
	deleteReceipt,
	extractReceipt,
	getReceipt,
	getReceiptImage,
	listReceipts,
	reviewReceipt,
	replaceReceiptImage,
} from "@/api/generated/endpoints.ts";
import type {
	ReceiptOutputBody,
	ReceiptDetails,
} from "@/api/generated/model/index.ts";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { serverQueryClient } from "./serverQuery.ts";
import { userResourceKey } from "./workspaceResources.ts";
import { useUserScope } from "./useUserScope.ts";

export const receiptCollectionKey = (
	transactionId: string,
	scope = getUserScope(),
) => ["receipts", scope.key, transactionId] as const;
export const receiptDetailKey = (id: string, scope = getUserScope()) =>
	["receipt-detail", scope.key, id] as const;

export function useReceipts(transactionId: string, enabled: boolean) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: receiptCollectionKey(transactionId, scope),
			enabled: enabled && scope.status === "ready",
			queryFn: async ({ signal }) =>
				(await listReceipts(transactionId, { signal })).data,
		},
		serverQueryClient(),
	);
}

export function useReceipt(id: string) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: receiptDetailKey(id, scope),
			enabled: scope.status === "ready",
			queryFn: async ({ signal }) => (await getReceipt(id, { signal })).data,
			refetchInterval: (query) =>
				query.state.data?.receipt.status === "extracting" ? 1500 : false,
		},
		serverQueryClient(),
	);
}

export function useReceiptImage(id: string, digest: string) {
	const scope = useUserScope();
	return useQuery(
		{
			queryKey: ["receipt-image", scope.key, id, digest],
			enabled: scope.status === "ready",
			gcTime: 0,
			staleTime: Infinity,
			queryFn: async ({ signal }) =>
				(await getReceiptImage(id, undefined, { signal })).data,
		},
		serverQueryClient(),
	);
}

function useReceiptWrite<T>(
	transactionId: string,
	perform: (input: T) => Promise<ReceiptOutputBody | undefined>,
) {
	const scope = useUserScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["receipt-write", scope.key, transactionId],
			retry: false,
			mutationFn: async (input: T) => {
				if (scope !== getUserScope() || scope.status !== "ready")
					throw new UserScopeError();
				const result = await perform(input);
				if (scope !== getUserScope()) throw new UserScopeError();
				return result;
			},
			onSuccess: async (result) => {
				if (scope !== getUserScope()) return;
				if (result)
					cache.setQueryData(
						receiptDetailKey(result.receipt.id, scope),
						result,
					);
				await cache.invalidateQueries({
					queryKey: receiptCollectionKey(transactionId, scope),
				});
				// Row badges read receiptIds from the transaction list. The
				// model envelope also carries the reverse lookup for any
				// remaining reader, so refresh both.
				await cache.invalidateQueries({
					queryKey: userResourceKey("transactions", scope),
				});
				await cache.invalidateQueries({
					queryKey: userResourceKey("model", scope),
				});
			},
		},
		cache,
	);
}

export function useReceiptActions(transactionId: string) {
	const attach = useReceiptWrite(
		transactionId,
		async (image: File) => (await attachReceipt({ image, transactionId })).data,
	);
	const extract = useReceiptWrite(
		transactionId,
		async (id: string) => (await extractReceipt(id)).data,
	);
	const review = useReceiptWrite(
		transactionId,
		async (input: {
			id: string;
			revision: number;
			details: ReceiptDetails;
			confirm: boolean;
		}) =>
			(
				await reviewReceipt(input.id, {
					revision: input.revision,
					details: input.details,
					confirm: input.confirm,
				})
			).data,
	);
	const remove = useReceiptWrite(transactionId, async (id: string) => {
		await deleteReceipt(id);
		return undefined;
	});
	const replace = useReceiptWrite(
		transactionId,
		async (input: { id: string; revision: number; image: File }) =>
			(
				await replaceReceiptImage(input.id, {
					revision: input.revision,
					image: input.image,
				})
			).data,
	);
	return { attach, extract, review, remove, replace };
}
