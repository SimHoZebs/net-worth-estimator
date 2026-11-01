import { useQuery } from "@tanstack/react-query";
import { listIntegrations } from "@/api/generated/endpoints.ts";
import type { ProviderEntry } from "@/api/generated/model/index.ts";
import {
	getUserScope,
	subscribeUserScope,
} from "@/auth/resourceScope.ts";
import { dismissKey, notifyError } from "@/state/notifications.ts";
import { serverQueryClient } from "@/state/serverQuery.ts";
import { useUserScope } from "@/state/useUserScope.ts";

export function integrationsKey(scope = getUserScope()) {
	return ["integrations", scope.key] as const;
}

function integrationsOptions(scope = getUserScope()) {
	return {
		queryKey: integrationsKey(scope),
		staleTime: 30_000,
		queryFn: async ({ signal }: { signal: AbortSignal }) => {
			try {
				const data = (await listIntegrations({ signal })).data;
				if (scope !== getUserScope() || signal.aborted)
					throw new Error(
						"The active resource changed or the request was canceled.",
					);
				dismissKey("integrations");
				return (data.providers ?? []) as ProviderEntry[];
			} catch (error) {
				if (scope === getUserScope() && !signal.aborted)
					notifyError(
						"integrations",
						error instanceof Error
							? error.message
							: "The integrations could not be loaded.",
						{
							label: "Reload integrations",
							onAction: () => void refreshIntegrations(true),
						},
					);
				throw error;
			}
		},
	};
}

export async function refreshIntegrations(force = false): Promise<void> {
	const scope = getUserScope();
	if (scope.status === "pending") return;
	try {
		const options = integrationsOptions(scope);
		if (force)
			await serverQueryClient().invalidateQueries({
				queryKey: options.queryKey,
				refetchType: "none",
			});
		await serverQueryClient().fetchQuery(options);
	} catch {
		/* The query reports its current-resource failure. */
	}
}

export function resetIntegrationsClient(): void {
	serverQueryClient().removeQueries({ queryKey: ["integrations"] });
}

subscribeUserScope(resetIntegrationsClient);

export function useIntegrations() {
	const scope = useUserScope();
	return useQuery(
		{ ...integrationsOptions(scope), enabled: scope.status === "ready" },
		serverQueryClient(),
	);
}
