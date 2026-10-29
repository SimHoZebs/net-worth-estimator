export interface SessionAccount {
	id: string;
	kind: "sample" | "private";
	permissions: string[];
}

/** @deprecated Use SessionAccount. Kept for store/auth lanes during rebase. */
export type SessionResource = SessionAccount;

export interface AccountScopeInput {
	apiBaseUrl: string;
	resource: SessionAccount;
	subject: string | null;
}

/** @deprecated Use AccountScopeInput. */
export type ResourceScopeInput = AccountScopeInput;

export interface AccountScope extends Omit<AccountScopeInput, "resource"> {
	resource: SessionAccount | null;
	status: "pending" | "ready";
	key: string;
}

/** @deprecated Use AccountScope. */
export type ResourceScope = AccountScope;

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

/**
 * Canonical account id for browser state. The server still asserts
 * `plans/*` on the wire; browser keys use `accounts/*` (or `user:<hash>`)
 * so the product language stays account-scoped. Legacy `plans/*` ids map
 * one-to-one, which also invalidates cached `plans/*` keys.
 */
export function normalizeAccountId(id: string): string {
	if (id === "plans/sample") return "accounts/sample";
	if (id.startsWith("plans/")) return `accounts/${id.slice("plans/".length)}`;
	return id;
}

/** Reverse mapping for the wire header, which still expects the server id. */
export function denormalizeAccountId(id: string): string {
	if (id === "accounts/sample") return "plans/sample";
	if (id.startsWith("accounts/"))
		return `plans/${id.slice("accounts/".length)}`;
	return id;
}

export function isAccountId(id: string): boolean {
	return (
		id === "accounts/sample" ||
		id === "plans/sample" ||
		/^(plans|accounts)\/[a-f0-9]{64}$/.test(id) ||
		/^user:[a-f0-9]{64}$/.test(id)
	);
}

/** Browser data always belongs to a verified account. */
export function accountStorageKey(
	baseKey: string,
	scope: AccountScope = getAccountScope(),
): string | null {
	if (scope.status === "pending" || !scope.resource) return null;
	const owner = `${scope.resource.kind}:${encodeURIComponent(
		normalizeAccountId(scope.resource.id),
	)}`;
	return `${baseKey}:account:${encodeURIComponent(scope.apiBaseUrl)}:${owner}`;
}

/** @deprecated Use accountStorageKey. Returns the canonical account key. */
export function resourceStorageKey(
	baseKey: string,
	scope: AccountScope = getAccountScope(),
): string | null {
	return accountStorageKey(baseKey, scope);
}

/** Previous `:resource:` key shape, for cache invalidation and migration reads. */
export function legacyResourceStorageKey(
	baseKey: string,
	scope: AccountScope = getAccountScope(),
): string | null {
	if (scope.status === "pending" || !scope.resource) return null;
	const owner = `${scope.resource.kind}:${encodeURIComponent(scope.resource.id)}`;
	return `${baseKey}:resource:${encodeURIComponent(scope.apiBaseUrl)}:${owner}`;
}

export function accountScopeKey(input: AccountScopeInput): string {
	return JSON.stringify([
		input.apiBaseUrl,
		normalizeAccountId(input.resource.id),
		input.resource.kind,
		input.subject,
		[...input.resource.permissions].sort(),
	]);
}

/** @deprecated Use accountScopeKey. */
export function resourceScopeKey(input: AccountScopeInput): string {
	return accountScopeKey(input);
}

export function getAccountScope(): AccountScope {
	return current;
}

/** @deprecated Use getAccountScope. */
export function getResourceScope(): AccountScope {
	return current;
}

export function subscribeAccountScope(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

/** @deprecated Use subscribeAccountScope. */
export function subscribeResourceScope(listener: () => void): () => void {
	return subscribeAccountScope(listener);
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

/** @deprecated Use suspendAccountScope. */
export function suspendResourceScope(): AccountScope {
	return suspendAccountScope();
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

/** @deprecated Use acceptAccountScope. */
export function acceptResourceScope(
	input: AccountScopeInput,
	expected: AccountScope,
): AccountScope | null {
	return acceptAccountScope(input, expected);
}

/** API clients call this for a current response with a missing/mismatched scope. */
export function requireAccountRecheck(): void {
	suspendAccountScope();
	if (typeof window !== "undefined")
		window.dispatchEvent(new Event("waypoint:authentication-required"));
}

/** @deprecated Use requireAccountRecheck. */
export function requireSessionRecheck(): void {
	requireAccountRecheck();
}
