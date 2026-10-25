import {
	canonicalApiBaseUrl,
	getResourceScope,
	requireSessionRecheck,
	subscribeResourceScope,
	type ResourceScope,
} from "../auth/resourceScope.ts";
import type { ApiHttpError, FetchLike } from "./client.ts";

export class ResourceScopeError extends Error {
	readonly status = 409;
	constructor(
		message = "The active plan changed. Verify your session before continuing.",
	) {
		super(message);
		this.name = "ResourceScopeError";
	}
}

export interface ScopedResponse {
	response: Response;
	scope: ResourceScope;
}

/** Renew shared clients after verification without retargeting existing references. */
export function resourceScopedFactory<T>(create: () => T): () => T {
	let cached: { scope: ResourceScope; value: T } | undefined;
	return () => {
		const scope = getResourceScope();
		if (cached?.scope !== scope) cached = { scope, value: create() };
		return cached.value;
	};
}

export function responseScopeError(
	scope: ResourceScope,
): ResourceScopeError | null {
	return scope === getResourceScope() ? null : new ResourceScopeError();
}

/** Only the server's resource-change error requests a new session check. */
export function scopedResponseError(
	scope: ResourceScope,
	error: ApiHttpError,
): ApiHttpError | ResourceScopeError {
	const stale = responseScopeError(scope);
	if (stale) return stale;
	if (error.status === 409 && error.problem?.code === "RESOURCE_CHANGED") {
		requireSessionRecheck();
		return new ResourceScopeError();
	}
	return error;
}

/** One lifetime covers fetch, JSON body reads, and streaming response consumption. */
function requestLifetime(scope: ResourceScope, signal?: AbortSignal | null) {
	const controller = new AbortController();
	const forwardAbort = () => controller.abort(signal?.reason);
	const stopScope = subscribeResourceScope(() => {
		if (scope !== getResourceScope())
			controller.abort(new ResourceScopeError());
	});
	if (signal?.aborted) forwardAbort();
	else signal?.addEventListener("abort", forwardAbort, { once: true });
	return {
		signal: controller.signal,
		dispose: () => {
			stopScope();
			signal?.removeEventListener("abort", forwardAbort);
		},
	};
}

function guardedBody(
	response: Response,
	lifetime: ReturnType<typeof requestLifetime>,
): Response {
	if (!response.body) {
		lifetime.dispose();
		return response;
	}
	const reader = response.body.getReader();
	let closed = false;
	let output: ReadableStreamDefaultController<Uint8Array> | undefined;
	const finish = () => {
		closed = true;
		lifetime.signal.removeEventListener("abort", abort);
		lifetime.dispose();
	};
	const abort = () => {
		if (closed) return;
		const reason = lifetime.signal.reason;
		finish();
		output?.error(reason);
		void reader.cancel(reason).catch(() => {});
	};
	const body = new ReadableStream<Uint8Array>({
		start(controller) {
			output = controller;
			lifetime.signal.addEventListener("abort", abort, { once: true });
			if (lifetime.signal.aborted) abort();
		},
		async pull(controller) {
			try {
				const next = await reader.read();
				if (closed) return;
				if (lifetime.signal.aborted) {
					abort();
					return;
				}
				if (next.done) {
					finish();
					controller.close();
				} else controller.enqueue(next.value);
			} catch (cause) {
				if (closed) return;
				finish();
				controller.error(cause);
			}
		},
		async cancel(reason) {
			finish();
			await reader.cancel(reason);
		},
	});
	return new Response(body, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});
}

export async function scopedRequest(
	baseUrl: string,
	url: string,
	init: RequestInit,
	fetcher: FetchLike,
	scope: ResourceScope,
): Promise<ScopedResponse | ResourceScopeError> {
	// Canceled workspace work stays canceled, even if the same plan is active again.
	const changed = responseScopeError(scope);
	if (changed) return changed;
	if (scope.status === "pending" || !scope.resource)
		return new ResourceScopeError(
			"Verify your session before requesting workspace data.",
		);
	if (canonicalApiBaseUrl(baseUrl) !== scope.apiBaseUrl)
		return new ResourceScopeError(
			"The API address does not match the verified workspace.",
		);
	const lifetime = requestLifetime(scope, init.signal);
	const headers = new Headers(init.headers);
	// The assertion always comes from discovery, never caller-supplied options.
	headers.delete("X-Waypoint-Resource");
	headers.set("X-Waypoint-Resource", scope.resource.id);
	let response: Response;
	try {
		response = await fetcher(url, {
			...init,
			headers,
			signal: lifetime.signal,
			credentials: "same-origin",
			redirect: "error",
			cache: "no-store",
		});
	} catch (cause) {
		lifetime.dispose();
		const stale = responseScopeError(scope);
		if (stale) return stale;
		throw cause;
	}
	const stale = responseScopeError(scope);
	if (
		stale ||
		(response.ok &&
			response.headers.get("X-Waypoint-Resource") !== scope.resource.id)
	) {
		lifetime.dispose();
		void response.body?.cancel().catch(() => {});
		if (!stale) requireSessionRecheck();
		return stale ?? new ResourceScopeError();
	}
	return { response: guardedBody(response, lifetime), scope };
}
