import { getSafeSpendingSettings } from "@/api/generated/endpoints.ts";
import { getUserScope, type UserScope } from "@/auth/resourceScope.ts";
import type { SafeSpendingSettings } from "@/api/contracts.ts";

/** Backend authority for safe-spending settings. */
export async function readSafeSpendingSettings(
	scope: UserScope,
	sanitize: (value: unknown) => SafeSpendingSettings,
	signal?: AbortSignal,
): Promise<SafeSpendingSettings | null> {
	if (scope.status === "pending") return null;
	try {
		const data = (await getSafeSpendingSettings({ signal })).data;
		if (scope !== getUserScope()) return null;
		const settings = (data.settings ?? null) as SafeSpendingSettings | null;
		return settings ? sanitize(settings) : null;
	} catch (error) {
		throw error instanceof Error ? error : new Error(String(error));
	}
}
