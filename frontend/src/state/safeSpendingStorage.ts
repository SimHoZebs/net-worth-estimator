import { ApiHttpError } from "@/api/http.ts";
import {
	getSafeSpendingSettings,
	setSafeSpendingSettings,
} from "@/api/generated/endpoints.ts";
import { getAccountScope, type AccountScope } from "@/auth/resourceScope.ts";
import type { SafeSpendingSettings } from "@/api/contracts.ts";
import {
	accountLocalStorage,
	SAFE_SPENDING_STORAGE_KEY,
} from "@/state/persisted.ts";

/** Backend authority with a one-time, verified-owner browser import. */
export async function readSafeSpendingSettings(
	scope: AccountScope,
	sanitize: (value: unknown) => SafeSpendingSettings,
	signal?: AbortSignal,
): Promise<SafeSpendingSettings | null> {
	const name = SAFE_SPENDING_STORAGE_KEY;
	if (scope.status === "pending") return null;
	let settings: SafeSpendingSettings | null;
	try {
		const data = (await getSafeSpendingSettings({ signal })).data;
		if (scope !== getAccountScope()) return null;
		settings = (data.settings ?? null) as SafeSpendingSettings | null;
	} catch (error) {
		throw error instanceof Error ? error : new Error(String(error));
	}
	if (settings === null) {
		const storage = accountLocalStorage(scope);
		const raw = await storage.getItem(name);
		if (scope !== getAccountScope() || signal?.aborted) return null;
		if (raw) {
			try {
				const legacy = sanitize(JSON.parse(raw));
				let saved: SafeSpendingSettings | null;
				try {
					const data = (await setSafeSpendingSettings(legacy as never)).data;
					if (scope !== getAccountScope()) return null;
					saved = (data.settings ?? null) as SafeSpendingSettings | null;
				} catch (error) {
					// A read-only server can still display backend defaults.
					// Keep the browser record for a later writable session.
					if (error instanceof ApiHttpError && error.status === 403)
						return null;
					throw error;
				}
				settings = saved;
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
