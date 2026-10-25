import type { PersistStorage } from "zustand/middleware";
import { ApiError, createApiClient } from "../api/client.ts";
import { getResourceScope, type ResourceScope } from "../auth/resourceScope.ts";
import type { SafeSpendingSettings } from "../api/contracts.ts";
import { notifyError, dismissKey } from "./notifications.ts";
import { resourceLocalStorage } from "./persisted.ts";

/** Backend authority with a one-time, verified-owner browser import. */
export function safeSpendingStorage(
	scope: ResourceScope,
	canWrite: () => boolean,
	sanitize: (value: unknown) => SafeSpendingSettings,
	onLoadError: (error: Error) => void,
	onRetry: () => void,
): PersistStorage<SafeSpendingSettings> {
	const client = createApiClient({ baseUrl: scope.apiBaseUrl });
	let writes = Promise.resolve();
	return {
		getItem: async (name) => {
			if (scope.status === "pending") return null;
			await writes;
			const result = await client.getSafeSpendingSettings();
			if (scope !== getResourceScope()) return null;
			if (result instanceof Error) {
				onLoadError(result);
				return null;
			}
			let settings = result.settings;
			if (
				settings === null &&
				scope.resource?.permissions.includes("plan:write")
			) {
				const storage = resourceLocalStorage(scope);
				const raw = await storage.getItem(name);
				if (raw) {
					try {
						const legacy = sanitize(JSON.parse(raw));
						const saved = await client.setSafeSpendingSettings(legacy);
						if (scope !== getResourceScope()) return null;
						if (saved instanceof Error) {
							// A read-only server can still display backend defaults.
							// Keep the browser record for a later writable session.
							if (saved instanceof ApiError && saved.status === 403)
								return null;
							onLoadError(saved);
							return null;
						}
						settings = saved.settings;
						storage.removeItem(name);
					} catch {
						// A corrupt browser record cannot replace backend settings.
					}
				}
			}
			return settings ? { state: sanitize(settings), version: 4 } : null;
		},
		setItem: (_name, value) => {
			if (!canWrite()) return;
			// Serialize snapshots so rapid edits cannot commit out of order.
			writes = writes.then(async () => {
				if (scope !== getResourceScope()) return;
				const result = await client.setSafeSpendingSettings(value.state);
				if (scope !== getResourceScope()) return;
				if (result instanceof Error) {
					notifyError(
						"safe-spending-settings",
						`Budget settings were not saved. ${result.message}`,
						{
							label: "Retry save",
							onAction: onRetry,
						},
					);
				} else dismissKey("safe-spending-settings");
			});
			return writes;
		},
		removeItem: () => {},
	};
}
