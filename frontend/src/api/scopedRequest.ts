import {
	canonicalApiBaseUrl,
	getAccountScope,
	requireAccountRecheck,
	subscribeAccountScope,
	type AccountScope,
} from "../auth/resourceScope.ts";
import type { ApiHttpError, FetchLike } from "./http.ts";

export class AccountScopeError extends Error {
	readonly status = 409;
	constructor(
		message = "The active account changed. Verify your session before continuing.",
	) {
		super(message);
		this.name = "AccountScopeError";
	}
}

export interface ScopedResponse {
	response: Response;
	scope: AccountScope;
}

export function responseScopeError(
	scope: AccountScope,
): AccountScopeError | null {
	return scope === getAccountScope() ? null : new AccountScopeError();
}

/** Only the server's resource-change error requests a new session check. */
export function scopedResponseError(
	scope: AccountScope,
	error: ApiHttpError,
): ApiHttpError | AccountScopeError {
	const stale = responseScopeError(scope);
	if (stale) return stale;
	if (error.status === 409 && error.problem?.code === "RESOURCE_CHANGED") {
		requireAccountRecheck();
		return new AccountScopeError();
	}
	return error;
}

/** One lifetime covers fetch, JSON body reads, and streaming response consumption. */
function requestLifetime(scope: AccountScope, signal?: AbortSignal | null) {
	const controller = new AbortController();
	const forwardAbort = () => controller.abort(signal?.reason);
	const stopScope = subscribeAccountScope(() => {
		if (scope !== getAccountScope()) controller.abort(new AccountScopeError());
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
	scope: AccountScope,
): Promise<ScopedResponse | AccountScopeError> {
	if (scope.status === "pending" || !scope.resource)
		return new AccountScopeError(
			"Verify your session before requesting account data.",
		);
	if (canonicalApiBaseUrl(baseUrl) !== scope.apiBaseUrl)
		return new AccountScopeError(
			"The API address does not match the verified account.",
		);
	const current = getAccountScope();
	if (scope !== current) {
		// Retired same-account work stays retired. The server cannot tell it
		// apart (same account ID, same cookie), so block it before network access.
		// A signed-out browser has no verified account: fail fast.
		if (
			current.status === "pending" ||
			!current.resource ||
			current.resource.id === scope.resource.id
		)
			return new AccountScopeError();
		// Different account: send the pinned original ID and let the backend
		// reject with 409 RESOURCE_CHANGED. Never retarget the header.
	}
	const lifetime = requestLifetime(scope, init.signal);
	const headers = new Headers(init.headers);
	// The assertion always comes from discovery, never caller-supplied options.
	headers.delete("Waypoint-Resource");
	headers.set("Waypoint-Resource", scope.resource.id);
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
			response.headers.get("Waypoint-Resource") !== scope.resource.id)
	) {
		lifetime.dispose();
		void response.body?.cancel().catch(() => {});
		if (!stale) requireAccountRecheck();
		return stale ?? new AccountScopeError();
	}
	return { response: guardedBody(response, lifetime), scope };
}
