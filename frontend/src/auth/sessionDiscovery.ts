import { getApiBaseUrl } from "@/api/runtime.ts";
import { getAuthSession } from "@/api/generated/endpoints.ts";
import { ApiHttpError, ApiNetworkError } from "@/api/http.ts";
import { serverQueryClient, sessionQueryKey } from "@/state/serverQuery.ts";
import { isRecord } from "@/domain/guards.ts";
import type { Session } from "@/auth/sessionContext.ts";
import {
	canonicalApiBaseUrl,
	type UserScopeInput,
} from "@/auth/resourceScope.ts";

export function sessionScopeInput(
	session: Session,
	baseUrl = getApiBaseUrl(),
): UserScopeInput {
	return {
		apiBaseUrl: canonicalApiBaseUrl(baseUrl),
		resource: session.resource,
		subject: session.user.subject,
	};
}

export async function discoverSession(
	signal: AbortSignal,
	baseUrl = getApiBaseUrl(),
): Promise<Session> {
	const queryKey = sessionQueryKey(canonicalApiBaseUrl(baseUrl));
	const cache = serverQueryClient();
	const cancel = () => {
		void cache.cancelQueries({ queryKey, exact: true });
	};
	signal.throwIfAborted();
	signal.addEventListener("abort", cancel, { once: true });
	try {
		return await cache.fetchQuery({
			queryKey,
			// One check, no retry, and no retained session body. Resource-cache
			// eviction skips this root, so discovery survives logout and owner
			// changes while its caller owns the abort.
			gcTime: 0,
			staleTime: 0,
			retry: false,
			queryFn: ({ signal: querySignal }) =>
				readSession(AbortSignal.any([signal, querySignal]), baseUrl),
		});
	} finally {
		signal.removeEventListener("abort", cancel);
	}
}

async function readSession(
	signal: AbortSignal,
	baseUrl: string,
): Promise<Session> {
	let response: Awaited<ReturnType<typeof getAuthSession>>;
	try {
		response = await getAuthSession({ signal, baseUrl });
	} catch (cause) {
		if (signal.aborted) throw cause;
		if (cause instanceof ApiNetworkError)
			throw new Error(
				"Cannot reach the Waypoint server. It may be down or restarting.",
			);
		if (cause instanceof ApiHttpError && [502, 503, 504].includes(cause.status))
			throw new Error(
				`The Waypoint server is unavailable (HTTP ${cause.status}). It may be restarting; retry shortly.`,
			);
		throw new Error("Authentication status is unavailable.");
	}
	const next: unknown = response.data;
	if (!isRecord(next) || next.enabled !== true)
		throw new Error("Invalid authentication status.");
	// Go's CanonicalOrigin is the authority; JS mirrors it here.
	if (baseUrl && new URL(baseUrl, location.href).origin !== location.origin)
		throw new Error(
			"Session login requires the frontend and API on the same origin.",
		);
	if (
		typeof next.authenticated !== "boolean" ||
		typeof next.allowed !== "boolean"
	)
		throw new Error("Invalid authentication status.");
	const resource: unknown = next.resource;
	// Every identity is an ordinary provisioned user id (`users/<64hex>`),
	// guests included. No guest/sample ids, no kind inference, no legacy
	// wire support.
	const resourceId =
		isRecord(resource) && typeof resource.id === "string" ? resource.id : null;
	const canonicalId =
		typeof resourceId === "string" && /^users\/[a-f0-9]{64}$/.test(resourceId);
	const subject =
		isRecord(next.user) && typeof next.user.subject === "string"
			? next.user.subject
			: null;
	if (
		!isRecord(resource) ||
		!canonicalId ||
		!Array.isArray(resource.permissions) ||
		!resource.permissions.every(
			(permission) => typeof permission === "string" && permission.length > 0,
		) ||
		response.headers.get("Waypoint-Resource") !== resourceId ||
		!subject ||
		!subject.trim()
	)
		throw new Error(
			"The server returned an invalid user resource. Retry the session check.",
		);
	return next as unknown as Session;
}
