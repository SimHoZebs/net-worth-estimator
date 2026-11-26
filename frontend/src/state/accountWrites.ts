import { deleteAccount } from "@/api/generated/endpoints.ts";
import { getUserScope } from "@/auth/resourceScope.ts";
import { analysisFindingsKey, transferLinksKey } from "@/state/analyses.ts";
import { refreshPins } from "@/state/pinnedEvaluations.ts";
import {
	financialQueryFilter,
	serverQueryClient,
} from "@/state/serverQuery.ts";
import { refreshSafeSpendingSettings } from "@/state/useSafeSpendingSettings.ts";
import { performSave } from "@/state/workspaceWrites.ts";
import {
	reloadWorkspace,
	refreshPaymentTerms,
} from "@/state/workspaceResources.ts";

async function refreshAfterAccountDeletion(): Promise<void> {
	const scope = getUserScope();
	const modelOk = await reloadWorkspace({ waitForWrites: false });
	if (!modelOk) throw new Error("The workspace could not be reloaded.");
	await refreshPaymentTerms();
	await refreshSafeSpendingSettings();
	await refreshPins(true);
	const cache = serverQueryClient();
	await Promise.all([
		cache.invalidateQueries({
			queryKey: ["user-resources", scope.key, "sharing-policy"],
			refetchType: "none",
		}),
		cache.invalidateQueries({
			queryKey: ["user-resources", scope.key, "sharing-grants"],
			refetchType: "none",
		}),
		cache.invalidateQueries({
			queryKey: ["user-resources", scope.key, "sharing-preview"],
			refetchType: "none",
		}),
		cache.invalidateQueries({
			queryKey: ["user-resources", scope.key, "group-feed"],
			refetchType: "none",
		}),
		cache.invalidateQueries({
			queryKey: ["user-resources", scope.key, "card-statements"],
			refetchType: "none",
		}),
		cache.invalidateQueries({
			queryKey: analysisFindingsKey(scope),
			refetchType: "none",
		}),
		cache.invalidateQueries({
			queryKey: transferLinksKey(scope),
			refetchType: "none",
		}),
		cache.invalidateQueries({
			queryKey: ["user-resources", scope.key, "analyses"],
			refetchType: "none",
		}),
		cache.invalidateQueries({
			...financialQueryFilter(scope.key),
			refetchType: "none",
		}),
		cache.invalidateQueries({
			queryKey: ["flow-graph", scope.key],
			refetchType: "none",
		}),
	]);
}

/**
 * Deletes one manual account and its dependent history. The persisted signal
 * lets a destructive dialog navigate away when only the post-delete reload
 * fails, instead of offering a second deletion.
 */
export async function deleteSavedAccount(
	id: string,
	onRejected?: (message: string) => void,
): Promise<{ persisted: boolean; refreshed: boolean }> {
	let persisted = false;
	const refreshed = await performSave({
		call: async () => {
			const response = await deleteAccount(id);
			return { data: response.data ?? { saved: true } };
		},
		refresh: refreshAfterAccountDeletion,
		recover: refreshAfterAccountDeletion,
		failureMessage: "The account could not be deleted.",
		suppressToast: true,
		onRejected,
		onPersisted: () => {
			persisted = true;
		},
	});
	return { persisted, refreshed };
}
