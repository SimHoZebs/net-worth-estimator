import { getApiBaseUrl } from "@/api/runtime.ts";
import { getAuthSession } from "@/api/generated/endpoints.ts";
import { ApiHttpError, ApiNetworkError } from "@/api/http.ts";
import { sessionQueryClient } from "./sessionQuery.ts";
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
		subject: session.authenticated ? (session.user?.subject ?? null) : null,
	};
}

export async function discoverSession(
	signal: AbortSignal,
	baseUrl = getApiBaseUrl(),
): Promise<Session> {
	const queryKey = ["auth-session", canonicalApiBaseUrl(baseUrl)] as const;
	const cancel = () => {
		void sessionQueryClient.cancelQueries({ queryKey, exact: true });
	};
	signal.throwIfAborted();
	signal.addEventListener("abort", cancel, { once: true });
	try {
		return await sessionQueryClient.fetchQuery({
			queryKey,
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
	// Only canonical user ids (`users/*`). Sample is
	// `users/sample`. Legacy plan ids are rejected: no legacy wire support.
	const resourceId =
		isRecord(resource) && typeof resource.id === "string" ? resource.id : null;
	const authenticatedId =
		typeof resourceId === "string" && /^users\/[a-f0-9]{64}$/.test(resourceId);
	const sampleId = resourceId === "users/sample";
	if (
		!isRecord(resource) ||
		typeof resource.id !== "string" ||
		(next.authenticated ? !authenticatedId : !sampleId) ||
		resource.kind !== (next.authenticated ? "private" : "sample") ||
		!Array.isArray(resource.permissions) ||
		!resource.permissions.every(
			(permission) => typeof permission === "string" && permission.length > 0,
		) ||
		response.headers.get("Waypoint-Resource") !== resource.id ||
		(next.authenticated &&
			(!isRecord(next.user) ||
				typeof next.user.subject !== "string" ||
				!next.user.subject.trim()))
	)
		throw new Error(
			"The server returned an invalid user resource. Retry the session check.",
		);
	return next as unknown as Session;
}
