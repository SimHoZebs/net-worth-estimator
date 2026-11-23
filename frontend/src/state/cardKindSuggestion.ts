import { useMemo } from "react";
import type { AccountKind } from "@/api/contracts.ts";
import { UserScopeError } from "@/api/scopedRequest.ts";
import { cardKindFinding } from "@/domain/cardKindSuggestion.ts";
import { useAllAnalysisFindings } from "./allAnalysisFindings.ts";
import { useDismissAnalysisFinding } from "./analyses.ts";
import { dismissKey, notifyError } from "./notifications.ts";

/**
 * Reads the account's card-kind finding from the shared findings feed and
 * dismisses through the existing finding endpoint. No kind write lives here:
 * the suggestion only points the owner at the existing account type picker.
 */
export function useCardKindSuggestion(
	accountId: string,
	currentKind: AccountKind,
) {
	const query = useAllAnalysisFindings();
	const dismiss = useDismissAnalysisFinding();
	const finding = useMemo(
		() => cardKindFinding(query.data ?? [], accountId, currentKind),
		[query.data, accountId, currentKind],
	);

	const dismissFinding = async (): Promise<boolean> => {
		if (!finding || dismiss.isPending) return false;
		try {
			await dismiss.mutateAsync({ id: finding.id, dismissed: true });
			dismissKey("card-kind-suggestion");
			return true;
		} catch (cause) {
			if (!(cause instanceof UserScopeError))
				notifyError(
					"card-kind-suggestion",
					"The suggestion could not be dismissed. Try again.",
				);
			return false;
		}
	};

	return {
		finding,
		loading: query.isPending,
		dismissing: dismiss.isPending,
		dismiss: dismissFinding,
	};
}
