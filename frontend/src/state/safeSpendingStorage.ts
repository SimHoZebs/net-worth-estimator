import { ApiError, createApiClient } from "../api/client.ts";
import { getResourceScope, type ResourceScope } from "../auth/resourceScope.ts";
import type { SafeSpendingSettings } from "../api/contracts.ts";
import {
	resourceLocalStorage,
	SAFE_SPENDING_STORAGE_KEY,
} from "./persisted.ts";

/** Backend authority with a one-time, verified-owner browser import. */
export async function readSafeSpendingSettings(
	scope: ResourceScope,
	sanitize: (value: unknown) => SafeSpendingSettings,
	signal?: AbortSignal,
): Promise<SafeSpendingSettings | null> {
	const client = createApiClient({ baseUrl: scope.apiBaseUrl });
	const name = SAFE_SPENDING_STORAGE_KEY;
	if (scope.status === "pending") return null;
	const result = await client.getSafeSpendingSettings({ signal });
	if (scope !== getResourceScope()) return null;
	if (result instanceof Error) {
		throw result;
	}
	let settings = result.settings;
	if (settings === null && scope.resource?.permissions.includes("plan:write")) {
		const storage = resourceLocalStorage(scope);
		const raw = await storage.getItem(name);
		if (scope !== getResourceScope() || signal?.aborted) return null;
		if (raw) {
			try {
				const legacy = sanitize(JSON.parse(raw));
				const saved = await client.setSafeSpendingSettings(legacy);
				if (scope !== getResourceScope()) return null;
				if (saved instanceof Error) {
					// A read-only server can still display backend defaults.
					// Keep the browser record for a later writable session.
					if (saved instanceof ApiError && saved.status === 403) return null;
					throw saved;
				}
				settings = saved.settings;
				storage.removeItem(name);
			} catch (error) {
				if (error instanceof Error && !(error instanceof SyntaxError))
					throw error;
				// A corrupt browser record cannot replace backend settings.
			}
		}
	}
	return settings ? sanitize(settings) : null;
}
