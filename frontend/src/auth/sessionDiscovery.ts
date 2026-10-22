import { getApiBaseUrl } from "../api/runtime.ts";
import { isRecord } from "../domain/guards.ts";
import type { Session } from "./sessionContext.ts";
import {
	canonicalApiBaseUrl,
	type ResourceScopeInput,
} from "./resourceScope.ts";

export function sessionScopeInput(session: Session): ResourceScopeInput {
	return {
		apiBaseUrl: canonicalApiBaseUrl(getApiBaseUrl()),
		resource: session.enabled ? (session.resource ?? null) : null,
		subject:
			session.enabled && session.authenticated
				? (session.user?.subject ?? null)
				: null,
	};
}

export async function discoverSession(signal: AbortSignal): Promise<Session> {
	const response = await fetch(`${getApiBaseUrl()}/v1/auth/session`, {
		credentials: "same-origin",
		cache: "no-store",
		redirect: "error",
		signal,
	});
	if (!response.ok) throw new Error("Authentication status is unavailable.");
	const next: unknown = await response.json();
	if (!isRecord(next) || typeof next.enabled !== "boolean")
		throw new Error("Invalid authentication status.");
	if (!next.enabled) return { enabled: false };
	if (
		getApiBaseUrl() &&
		new URL(getApiBaseUrl(), location.href).origin !== location.origin
	)
		throw new Error(
			"Session login requires the frontend and API on the same origin.",
		);
	if (
		typeof next.authenticated !== "boolean" ||
		(next.allowed !== undefined && typeof next.allowed !== "boolean")
	)
		throw new Error("Invalid authentication status.");
	if (next.allowed) {
		const resource = next.resource;
		if (
			!isRecord(resource) ||
			typeof resource.id !== "string" ||
			(next.authenticated
				? !/^plans\/[a-f0-9]{64}$/.test(resource.id)
				: resource.id !== "plans/sample") ||
			resource.kind !== (next.authenticated ? "private" : "sample") ||
			!Array.isArray(resource.permissions) ||
			!resource.permissions.includes("plan:read") ||
			!resource.permissions.every(
				(permission) => typeof permission === "string" && permission.length > 0,
			) ||
			response.headers.get("X-Waypoint-Resource") !== resource.id ||
			(next.authenticated &&
				(!isRecord(next.user) ||
					typeof next.user.subject !== "string" ||
					!next.user.subject.trim()))
		)
			throw new Error(
				"The server returned an invalid workspace resource. Retry the session check.",
			);
	}
	return next as unknown as Session;
}
