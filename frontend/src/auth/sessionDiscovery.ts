import { getApiBaseUrl } from "../api/runtime.ts";
import { isRecord } from "../domain/guards.ts";
import type { Session } from "./sessionContext.ts";
import {
	canonicalApiBaseUrl,
	type ResourceScopeInput,
} from "./resourceScope.ts";

export function sessionScopeInput(
	session: Session,
	baseUrl = getApiBaseUrl(),
): ResourceScopeInput {
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
	const response = await fetch(`${baseUrl}/v1/auth/session`, {
		credentials: "same-origin",
		cache: "no-store",
		redirect: "error",
		signal,
	});
	if (!response.ok) throw new Error("Authentication status is unavailable.");
	const next: unknown = await response.json();
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
	const resource = next.resource;
	if (
		!isRecord(resource) ||
		typeof resource.id !== "string" ||
		(next.authenticated
			? !/^plans\/[a-f0-9]{64}$/.test(resource.id)
			: resource.id !== "plans/sample") ||
		resource.kind !== (next.authenticated ? "private" : "sample") ||
		!Array.isArray(resource.permissions) ||
		(next.allowed && !resource.permissions.includes("plan:read")) ||
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
	return next as unknown as Session;
}
