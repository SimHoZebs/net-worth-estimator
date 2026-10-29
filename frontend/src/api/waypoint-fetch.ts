import {
	ApiError,
	ApiNetworkError,
	ApiParseError,
	parseErrorResponse,
} from "@/api/http.ts";
import { getApiBaseUrl } from "@/api/runtime.ts";
import { getAccountScope } from "@/auth/resourceScope.ts";
import {
	AccountScopeError,
	scopedRequest,
	scopedResponseError,
	responseScopeError,
} from "@/api/scopedRequest.ts";

export interface WaypointRequestOptions extends RequestInit {
	baseUrl?: string;
}

/** Identity requests precede account verification and do not assert an account. */
export async function waypointAuthFetch<T>(
	url: string,
	options?: WaypointRequestOptions,
): Promise<T> {
	const response = await identityRequest(url, options);
	if (!response.ok) throw await parseErrorResponse(response);
	return {
		data: await response.json(),
		status: response.status,
		headers: response.headers,
	} as T;
}

async function identityRequest(
	url: string,
	options: WaypointRequestOptions = {},
): Promise<Response> {
	const { baseUrl = getApiBaseUrl(), ...init } = options;
	return globalThis
		.fetch(`${baseUrl.replace(/\/+$/, "")}${url}`, {
			...init,
			credentials: "same-origin",
			redirect: "error",
			cache: "no-store",
		})
		.catch((cause: unknown) => {
			throw new ApiNetworkError(cause);
		});
}

/** Logout must retire local state before the redirect body is consumed. */
export async function waypointLogoutFetch<_T>(
	url: string,
	options?: WaypointRequestOptions,
): Promise<Response> {
	return identityRequest(url, options);
}

/** Preserve the response stream, including its account-scoped lifetime. */
export async function waypointStreamFetch<_T>(
	url: string,
	options?: RequestInit,
): Promise<Response> {
	return accountRequest(url, options);
}

/** Binary responses use the same account assertion and guarded body lifetime. */
export async function waypointBlobFetch<T>(
	url: string,
	options?: RequestInit,
): Promise<T> {
	const response = await accountRequest(url, options);
	const data = await response.blob().catch((cause: unknown) => {
		if (cause instanceof AccountScopeError) throw cause;
		throw new ApiNetworkError(cause);
	});
	return { data, status: response.status, headers: response.headers } as T;
}

/**
 * Orval mutator. Generated endpoints delegate transport here so scope
 * capture, the Waypoint-Resource assertion, abort-on-scope-change, and the
 * shared error taxonomy stay in one place instead of forking a second
 * client. Application requests flow query/mutation -> generated endpoint ->
 * mutator; only the mutator uses the network transport
 * (clientBoundary.test.ts). Resolves the full response envelope; throws AccountScopeError or
 * ApiError; never resolves to Error.
 */
export async function waypointFetch<T>(
	url: string,
	options?: RequestInit,
): Promise<T> {
	const response = await accountRequest(url, options);
	const headers = response.headers;
	const status = response.status;
	if (status === 204) return { data: undefined, status, headers } as T;
	const text = await response.text().catch((cause: unknown) => {
		if (cause instanceof AccountScopeError) throw cause;
		throw new ApiNetworkError(cause);
	});
	if (!text.trim()) return { data: undefined, status, headers } as T;
	try {
		return { data: JSON.parse(text), status, headers } as T;
	} catch (cause) {
		throw new ApiParseError(cause);
	}
}

async function accountRequest(
	url: string,
	options?: RequestInit,
): Promise<Response> {
	const scope = getAccountScope();
	const baseUrl = getApiBaseUrl();
	const outcome = await scopedRequest(
		baseUrl,
		`${baseUrl.replace(/\/+$/, "")}${url.startsWith("/") ? url : `/${url}`}`,
		{
			...options,
			credentials: "same-origin",
			redirect: "error",
			cache: "no-store",
		},
		globalThis.fetch.bind(globalThis),
		scope,
	).catch((cause: unknown) => {
		if (cause instanceof ApiError) throw cause;
		throw new ApiNetworkError(cause);
	});
	if (outcome instanceof Error) throw outcome;
	const { response, scope: verified } = outcome;
	if (!response.ok) {
		const failure = await parseErrorResponse(response);
		throw scopedResponseError(verified, failure);
	}
	const stale = responseScopeError(verified);
	if (stale) throw stale;
	return response;
}
