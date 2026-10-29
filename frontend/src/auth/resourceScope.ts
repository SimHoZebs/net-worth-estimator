export interface SessionAccount {
	id: string;
	kind: "sample" | "private";
	permissions: string[];
}

export interface AccountScopeInput {
	apiBaseUrl: string;
	resource: SessionAccount;
	subject: string | null;
}

export interface AccountScope extends Omit<AccountScopeInput, "resource"> {
	resource: SessionAccount | null;
	status: "pending" | "ready";
	key: string;
}

const listeners = new Set<() => void>();
let current: AccountScope = {
	status: "pending",
	key: "pending",
	apiBaseUrl: "",
	resource: null,
	subject: null,
};

export function canonicalApiBaseUrl(baseUrl: string): string {
	return new URL(baseUrl || "/", location.href).href.replace(/\/+$/, "");
}

/** Browser data always belongs to a verified account. */
export function accountStorageKey(
	baseKey: string,
	scope: AccountScope = getAccountScope(),
): string | null {
	if (scope.status === "pending" || !scope.resource) return null;
	const owner = `${scope.resource.kind}:${encodeURIComponent(scope.resource.id)}`;
	return `${baseKey}:account:${encodeURIComponent(scope.apiBaseUrl)}:${owner}`;
}

export function accountScopeKey(input: AccountScopeInput): string {
	return JSON.stringify([
		input.apiBaseUrl,
		input.resource.id,
		input.resource.kind,
		input.subject,
		[...input.resource.permissions].sort(),
	]);
}

export function getAccountScope(): AccountScope {
	return current;
}

export function subscribeAccountScope(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function publish(scope: AccountScope): AccountScope {
	current = scope;
	for (const listener of listeners) listener();
	return scope;
}

/** Invalidate captured requests immediately, before React removes the account view. */
export function suspendAccountScope(): AccountScope {
	return publish({
		status: "pending",
		key: "pending",
		apiBaseUrl: current.apiBaseUrl,
		resource: null,
		subject: null,
	});
}

/** Only the session boundary may accept a server-verified scope. */
export function acceptAccountScope(
	input: AccountScopeInput,
	expected: AccountScope,
): AccountScope | null {
	if (current !== expected) return null;
	return publish({
		...input,
		status: "ready",
		key: accountScopeKey(input),
	});
}

/** API clients call this for a current response with a missing/mismatched scope. */
export function requireAccountRecheck(): void {
	suspendAccountScope();
	if (typeof window !== "undefined")
		window.dispatchEvent(new Event("waypoint:authentication-required"));
}
