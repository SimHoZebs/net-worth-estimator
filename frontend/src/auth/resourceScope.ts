export interface SessionUser {
	id: string;
	permissions: string[];
}

export interface UserScopeInput {
	apiBaseUrl: string;
	resource: SessionUser;
	subject: string | null;
}

export interface UserScope extends Omit<UserScopeInput, "resource"> {
	resource: SessionUser | null;
	status: "pending" | "ready";
	key: string;
}

const listeners = new Set<() => void>();
let current: UserScope = {
	status: "pending",
	key: "pending",
	apiBaseUrl: "",
	resource: null,
	subject: null,
};

export function canonicalApiBaseUrl(baseUrl: string): string {
	return new URL(baseUrl || "/", location.href).href.replace(/\/+$/, "");
}

export function userScopeKey(input: UserScopeInput): string {
	return JSON.stringify([
		input.apiBaseUrl,
		input.resource.id,
		input.subject,
		[...input.resource.permissions].sort(),
	]);
}

export function getUserScope(): UserScope {
	return current;
}

export function subscribeUserScope(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function publish(scope: UserScope): UserScope {
	current = scope;
	for (const listener of listeners) listener();
	return scope;
}

/** Invalidate captured requests immediately, before React removes the user view. */
export function suspendUserScope(): UserScope {
	return publish({
		status: "pending",
		key: "pending",
		apiBaseUrl: current.apiBaseUrl,
		resource: null,
		subject: null,
	});
}

/** Only the session boundary may accept a server-verified scope. */
export function acceptUserScope(
	input: UserScopeInput,
	expected: UserScope,
): UserScope | null {
	if (current !== expected) return null;
	return publish({
		...input,
		status: "ready",
		key: userScopeKey(input),
	});
}

/** API clients call this for a current response with a missing/mismatched scope. */
export function requireUserRecheck(): void {
	suspendUserScope();
	if (typeof window !== "undefined")
		window.dispatchEvent(new Event("waypoint:authentication-required"));
}
