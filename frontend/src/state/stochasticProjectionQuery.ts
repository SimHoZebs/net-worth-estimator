import { queryOptions } from "@tanstack/react-query";
import {
	parseSSE,
	requestStochasticProjection,
	type StochasticProjectionRequest,
	type StochasticProjectionResult,
} from "../api/index.ts";
import { ResourceScopeError } from "../api/scopedRequest.ts";
import { getResourceScope } from "../auth/resourceScope.ts";
import type { RangeResult } from "../domain/result.ts";
import { dismissKey, notifyError } from "./notifications.ts";

interface StreamSnapshot {
	range: RangeResult | null;
	progress: number;
	complete: boolean;
}

/** The query owns the stream and every published snapshot, not its first observer. */
export function stochasticProjectionOptions({
	queryKey,
	request,
	mapResult,
}: {
	queryKey: readonly unknown[];
	request: StochasticProjectionRequest | null;
	mapResult: (result: StochasticProjectionResult) => RangeResult;
}) {
	return queryOptions<StreamSnapshot>({
		queryKey,
		enabled: request !== null,
		retry: false,
		// A partial snapshot is never a reusable completed calculation.
		staleTime: (query) => (query.state.data?.complete ? Infinity : 0),
		queryFn: async ({ signal, client }): Promise<StreamSnapshot> => {
			if (!request) throw new Error("No scenario calculation was requested.");
			const scope = getResourceScope();
			let snapshot: StreamSnapshot = {
				range: null,
				progress: 0,
				complete: false,
			};
			const assertCurrent = () => {
				signal.throwIfAborted();
				if (getResourceScope() !== scope) throw new ResourceScopeError();
			};
			const publish = (update: Partial<StreamSnapshot>) => {
				assertCurrent();
				snapshot = { ...snapshot, ...update };
				client.setQueryData(queryKey, snapshot);
			};
			const progress = (fraction: number) =>
				Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
			try {
				publish(snapshot);
				const response = await requestStochasticProjection(request, {
					signal,
				});
				assertCurrent();
				let finalRange: RangeResult | null = null;
				let streamError: string | null = null;
				const parseError = await parseSSE(
					response,
					{
						onProgress: (data) =>
							publish({ progress: progress(data.progress.fraction) }),
						onPartial: (data) =>
							publish({
								progress: progress(data.progress.fraction),
								range: mapResult(data.partial),
							}),
						onResult: (data) => {
							finalRange = mapResult(data.result);
							publish({ range: finalRange, progress: 1 });
						},
						onError: (data) => {
							streamError = data.error;
						},
					},
					signal,
				);
				assertCurrent();
				if (!finalRange)
					throw new Error(
						streamError ??
							parseError?.message ??
							"The range stream ended before returning a result. Retry the calculation.",
					);
				dismissKey("projection-range");
				return { range: finalRange, progress: 1, complete: true };
			} catch (cause) {
				// Retired sessions and query cancellation never create retry notices.
				assertCurrent();
				const error =
					cause instanceof Error
						? cause
						: new Error("The range request failed. Retry the calculation.");
				if (!(error instanceof ResourceScopeError))
					notifyError("projection-range", error.message, {
						label: "Retry scenario calculation",
						onAction: () => {
							void client.refetchQueries({ queryKey, exact: true });
						},
					});
				throw error;
			}
		},
	});
}
