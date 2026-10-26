import {
	ApiError,
	ApiNetworkError,
	ApiParseError,
	parseErrorResponse,
} from "@/api/http.ts";
import { getApiBaseUrl } from "@/api/runtime.ts";
import { getResourceScope } from "@/auth/resourceScope.ts";
import {
	ResourceScopeError,
	scopedRequest,
	scopedResponseError,
	responseScopeError,
} from "@/api/scopedRequest.ts";

/**
 * Orval mutator. Generated endpoints delegate transport here so scope
 * capture, the Waypoint-Resource assertion, abort-on-scope-change, and the
 * shared error taxonomy stay in one place instead of forking a second
 * client. Resolves the full response envelope; throws ResourceScopeError or
 * ApiError; never resolves to Error.
 */
export async function waypointFetch<T>(
	url: string,
	options?: RequestInit,
): Promise<T> {
	const scope = getResourceScope();
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
	const headers = response.headers;
	const status = response.status;
	if (status === 204) return { data: undefined, status, headers } as T;
	const text = await response.text().catch((cause: unknown) => {
		if (cause instanceof ResourceScopeError) throw cause;
		throw new ApiNetworkError(cause);
	});
	if (!text.trim()) return { data: undefined, status, headers } as T;
	try {
		return { data: JSON.parse(text), status, headers } as T;
	} catch (cause) {
		throw new ApiParseError(cause);
	}
}
