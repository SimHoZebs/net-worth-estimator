import { getSafeSpendingSettings } from "@/api/generated/endpoints.ts";
import { getUserScope, type UserScope } from "@/auth/resourceScope.ts";

/** Backend authority for safe-spending settings. The shape is owned by the
 * sanitizer so callers can drop retired fields from the server response. */
export async function readSafeSpendingSettings<T>(
	scope: UserScope,
	sanitize: (value: unknown) => T,
	signal?: AbortSignal,
): Promise<T | null> {
	if (scope.status === "pending") return null;
	try {
		const data = (await getSafeSpendingSettings({ signal })).data;
		if (scope !== getUserScope()) return null;
		const settings = data.settings ?? null;
		return settings ? sanitize(settings) : null;
	} catch (error) {
		throw error instanceof Error ? error : new Error(String(error));
	}
}
