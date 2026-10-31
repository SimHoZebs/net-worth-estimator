import type { Projection, RangeResult } from "../../domain/result.ts";
import { usePinnedEvaluations } from "../../state/pinnedEvaluations.ts";
import { useRemoteProjection } from "../../state/useRemoteProjection.ts";
import { useSavedAccounts, useSavedEvaluations } from "../../state/savedRows.ts";

export type OutlookProjection = {
	base: Projection | null;
	range: RangeResult | null;
	pending: boolean;
	loading: boolean;
	baseError: string | null;
	retryProjection: () => void;
	status: "disabled" | "pending" | "error" | "success";
};

// Single-sourced outlook projection inputs. The chart, the pinned cards,
// and the safe-spending preview each subscribe through this hook where
// they use the data, so the outlook page never subscribes or passes the
// result down. Identical inputs keep one shared fetch.
export function useOutlookProjection(): OutlookProjection {
	const accounts = useSavedAccounts();
	const evaluations = useSavedEvaluations();
	const { ids: pinnedIds } = usePinnedEvaluations();
	const projection = useRemoteProjection({
		enabled: (accounts?.length ?? 0) > 0,
		// The chart no longer offers horizon or range switches, so Outlook
		// pins the horizon instead of inheriting possibly stale persisted
		// preferences. The stochastic range only feeds pinned threshold
		// cards, so it is requested only while one is pinned.
		years: 20,
		ranges:
			evaluations?.some((evaluation) =>
				(pinnedIds ?? []).includes(evaluation.id),
			) ?? false,
	});
	// Previous-input placeholders are not forecasts for the active model.
	const base =
		projection.base instanceof Error || projection.isPlaceholderData
			? null
			: projection.base;
	const pending =
		projection.status === "pending" ||
		(projection.isPlaceholderData && projection.loading);
	return {
		base,
		range: projection.range,
		pending,
		loading: projection.loading,
		baseError: projection.baseError,
		retryProjection: projection.retryProjection,
		status: projection.status,
	};
}
