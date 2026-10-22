export interface SessionResource {
	id: string;
	kind: "sample" | "private";
	permissions: string[];
}

export interface ResourceScopeInput {
	apiBaseUrl: string;
	resource: SessionResource | null;
	subject: string | null;
}

export interface ResourceScope extends ResourceScopeInput {
	status: "pending" | "legacy" | "ready";
	epoch: number;
	key: string;
}

const listeners = new Set<() => void>();
let current: ResourceScope = {
	status: "pending",
	epoch: 0,
	key: "pending:0",
	apiBaseUrl: "",
	resource: null,
	subject: null,
};

export function canonicalApiBaseUrl(baseUrl: string): string {
	return new URL(baseUrl || "/", location.href).href.replace(/\/+$/, "");
}

/** One namespace rule for all resource-owned browser data, including legacy mode. */
export function resourceStorageKey(
	baseKey: string,
	scope: ResourceScope = getResourceScope(),
): string | null {
	if (scope.status === "pending") return null;
	const owner = scope.resource
		? `${scope.resource.kind}:${encodeURIComponent(scope.resource.id)}`
		: "legacy";
	return `${baseKey}:resource:${encodeURIComponent(scope.apiBaseUrl)}:${owner}`;
}

export function resourceScopeKey(input: ResourceScopeInput): string {
	return JSON.stringify([
		input.apiBaseUrl,
		input.resource?.id ?? null,
		input.resource?.kind ?? "legacy",
		input.subject,
		[...(input.resource?.permissions ?? [])].sort(),
	]);
}

export function getResourceScope(): ResourceScope {
	return current;
}

export function subscribeResourceScope(listener: () => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

function publish(scope: ResourceScope): ResourceScope {
	current = scope;
	for (const listener of listeners) listener();
	return scope;
}

/** Invalidate captured requests immediately, before React removes the workspace. */
export function suspendResourceScope(): ResourceScope {
	const epoch = current.epoch + 1;
	return publish({
		status: "pending",
		epoch,
		key: `pending:${epoch}`,
		apiBaseUrl: current.apiBaseUrl,
		resource: null,
		subject: null,
	});
}

/** Only the session boundary may accept a server-verified scope. */
export function acceptResourceScope(
	input: ResourceScopeInput,
	expected: ResourceScope,
): ResourceScope | null {
	if (current !== expected) return null;
	return publish({
		...input,
		status: input.resource ? "ready" : "legacy",
		epoch: expected.epoch,
		key: resourceScopeKey(input),
	});
}

/** API clients call this for a current response with a missing/mismatched scope. */
export function requireSessionRecheck(): void {
	suspendResourceScope();
	if (typeof window !== "undefined")
		window.dispatchEvent(new Event("waypoint:authentication-required"));
}
