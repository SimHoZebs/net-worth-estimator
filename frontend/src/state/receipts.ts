import { useMutation, useQuery } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";
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
import { ResourceScopeError } from "@/api/scopedRequest.ts";
import {
	getResourceScope,
	subscribeResourceScope,
} from "@/auth/resourceScope.ts";
import { serverQueryClient } from "./serverQuery.ts";

export function useReceiptScope() {
	return useSyncExternalStore(subscribeResourceScope, getResourceScope);
}

export const receiptCollectionKey = (
	postingId: string,
	scope = getResourceScope(),
) => ["receipts", scope.key, postingId] as const;
export const receiptDetailKey = (id: string, scope = getResourceScope()) =>
	["receipt-detail", scope.key, id] as const;

export function useReceipts(postingId: string, enabled: boolean) {
	const scope = useReceiptScope();
	return useQuery(
		{
			queryKey: receiptCollectionKey(postingId, scope),
			enabled: enabled && scope.status === "ready",
			queryFn: async ({ signal }) =>
				(await listReceipts(postingId, { signal })).data,
		},
		serverQueryClient(),
	);
}

export function useReceipt(id: string) {
	const scope = useReceiptScope();
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
	const scope = useReceiptScope();
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
	postingId: string,
	perform: (input: T) => Promise<ReceiptOutputBody | undefined>,
) {
	const scope = useReceiptScope();
	const cache = serverQueryClient();
	return useMutation(
		{
			mutationKey: ["receipt-write", scope.key, postingId],
			retry: false,
			mutationFn: async (input: T) => {
				if (scope !== getResourceScope() || scope.status !== "ready")
					throw new ResourceScopeError();
				const result = await perform(input);
				if (scope !== getResourceScope()) throw new ResourceScopeError();
				return result;
			},
			onSuccess: async (result) => {
				if (scope !== getResourceScope()) return;
				if (result)
					cache.setQueryData(
						receiptDetailKey(result.receipt.id, scope),
						result,
					);
				await cache.invalidateQueries({
					queryKey: receiptCollectionKey(postingId, scope),
				});
			},
		},
		cache,
	);
}

export function useReceiptActions(postingId: string) {
	const attach = useReceiptWrite(
		postingId,
		async (image: File) => (await attachReceipt({ image, postingId })).data,
	);
	const extract = useReceiptWrite(
		postingId,
		async (id: string) => (await extractReceipt(id)).data,
	);
	const review = useReceiptWrite(
		postingId,
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
	const remove = useReceiptWrite(postingId, async (id: string) => {
		await deleteReceipt(id);
		return undefined;
	});
	const replace = useReceiptWrite(
		postingId,
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
