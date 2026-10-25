import * as errore from "errore";
import { isRecord } from "../domain/guards.ts";
import { getResourceScope } from "../auth/resourceScope.ts";
import type {
	AmountCatalogResponse,
	AmountPreset,
	AmountPresetDeleteResponse,
	AmountPresetListResponse,
	AmountPresetMoveResponse,
	AmountPresetWriteResponse,
	BackendAccount,
	BackendCheckpoint,
	BackendPosting,
	BackendRecurrenceRule,
	DeterministicProjectionRequest,
	DeterministicProjectionResponse,
	ErrorSSEData,
	EvaluationInstance,
	FinancialModelResponse,
	PinnedEvaluationsResponse,
	ProblemDetails,
	RowDeleteResponse,
	RowWriteResponse,
	ServerStatus,
	StochasticProjectionRequest,
	StochasticProjectionResult,
} from "./contracts.ts";
import { getApiBaseUrl } from "./runtime.ts";
import {
	responseScopeError,
	scopedRequest,
	scopedResponseError,
} from "./scopedRequest.ts";

export const DEFAULT_API_BASE_URL = "";
export const API_PREFIX = "/v1";

export type FetchLike = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

export interface ApiClientOptions {
	baseUrl?: string;
	apiBaseUrl?: string;
	fetch?: FetchLike;
}

export interface ApiRequestOptions {
	signal?: AbortSignal;
	headers?: HeadersInit;
}

export interface ApiErrorOptions {
	message: string;
	status?: number | null;
	problem?: ProblemDetails | null;
	detail?: string | null;
	cause?: unknown;
}

export class ApiError extends Error {
	readonly status: number | null;
	readonly problem: ProblemDetails | null;
	readonly detail: string | null;

	constructor({
		message,
		status = null,
		problem = null,
		detail = null,
		cause,
	}: ApiErrorOptions) {
		super(message, { cause });
		this.name = "ApiError";
		this.status = status;
		this.problem = problem;
		this.detail = detail;
	}
}

export class ApiNetworkError extends ApiError {
	constructor(cause: unknown) {
		super({
			message: "The API request failed. Check the server connection and retry.",
			cause,
		});
		this.name = "ApiNetworkError";
	}
}

export class ApiParseError extends ApiError {
	constructor(cause: unknown) {
		super({
			message:
				"The server returned invalid JSON. Check the API base URL and retry.",
			cause,
		});
		this.name = "ApiParseError";
	}
}

export class ApiRequestError extends ApiError {
	constructor(cause: unknown) {
		super({
			message:
				"The API request could not be encoded. Check the request values and retry.",
			cause,
		});
		this.name = "ApiRequestError";
	}
}

export class ApiHttpError extends ApiError {
	readonly status: number;

	constructor({
		message,
		status,
		problem = null,
		detail = null,
		cause,
	}: ApiErrorOptions & { status: number }) {
		super({ message, status, problem, detail, cause });
		this.name = "ApiHttpError";
		this.status = status;
	}
}

type ParsedBody =
	| { kind: "json"; value: unknown }
	| { kind: "text"; value: string }
	| { kind: "empty" }
	| Error;

function isJsonContentType(contentType: string | null): boolean {
	if (!contentType) return false;
	const value = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	return value === "application/json" || value.endsWith("+json");
}

function looksLikeJson(text: string): boolean {
	const value = text.trim();
	return value.startsWith("{") || value.startsWith("[");
}

function safeText(text: string): string {
	const value = [...text]
		.map((character) => {
			const code = character.charCodeAt(0);
			return code < 32 || code === 127 ? " " : character;
		})
		.join("")
		.trim();
	if (value.length <= 500) return value;
	return `${value.slice(0, 500)}…`;
}

function asProblem(value: unknown): ProblemDetails | null {
	if (!isRecord(value)) return null;
	const hasProblemField = [
		"type",
		"title",
		"status",
		"detail",
		"instance",
	].some((key) => key in value);
	if (!hasProblemField) return null;
	return value as ProblemDetails;
}

async function readBody(response: Response): Promise<ParsedBody> {
	const text = await response.text().catch(
		(cause) =>
			new ApiError({
				message: "The API response could not be read. Retry the request.",
				cause,
			}),
	);
	if (text instanceof Error) return text;
	if (!text.trim()) return { kind: "empty" };

	const shouldParseJson =
		isJsonContentType(response.headers.get("content-type")) ||
		(!response.headers.get("content-type") && looksLikeJson(text));
	if (shouldParseJson) {
		const parsed = errore.try({
			try: () => JSON.parse(text) as unknown,
			catch: (cause) => new ApiParseError(cause),
		});
		if (parsed instanceof Error) return parsed;
		return { kind: "json", value: parsed };
	}
	return { kind: "text", value: text };
}

function httpMessage(status: number, detail: string | null): string {
	const suffix = detail ? ` ${detail}` : "";
	if (status === 401)
		return `Your session needs verification. Sign in and retry this request.${suffix}`;
	if (status === 403)
		return `The server is read-only. Enable writes on the server before saving.${suffix}`;
	if (status === 409)
		return `The request conflicts with the current server data.${suffix}`;
	if (status === 429)
		return `The server rate-limited this request. Wait before retrying.${suffix}`;
	if (status === 503)
		return `The service is unavailable. Check server configuration and retry.${suffix}`;
	return detail
		? `The API request failed with HTTP ${status}: ${detail}`
		: `The API request failed with HTTP ${status}. Retry the request.`;
}

export async function parseErrorResponse(
	response: Response,
): Promise<ApiHttpError> {
	if (
		response.status === 401 &&
		response.headers.get("www-authenticate") === "Session" &&
		typeof window !== "undefined"
	) {
		window.dispatchEvent(new Event("waypoint:authentication-required"));
	}
	const body = await readBody(response);
	if (body instanceof Error) {
		return new ApiHttpError({
			message: httpMessage(response.status, null),
			status: response.status,
			cause: body,
		});
	}
	const problem = body.kind === "json" ? asProblem(body.value) : null;
	const detail =
		problem?.detail ??
		problem?.title ??
		(body.kind === "text" ? safeText(body.value) : null);
	return new ApiHttpError({
		message: httpMessage(response.status, detail),
		status: response.status,
		problem,
		detail,
	});
}

function path(baseUrl: string, route: string): string {
	return `${baseUrl.replace(/\/+$/, "")}/${route.replace(/^\/+/, "")}`;
}

function requestHeaders({
	body,
	headers,
	accept,
}: {
	body: boolean;
	headers?: HeadersInit;
	accept: string;
}): Headers | ApiRequestError {
	return errore.try({
		try: () => {
			const result = new Headers(headers);
			if (body && !result.has("content-type"))
				result.set("content-type", "application/json");
			if (!result.has("accept")) result.set("accept", accept);
			// Application access uses HttpOnly session cookies, never a shared token.
			result.delete("authorization");
			return result;
		},
		catch: (cause) => new ApiRequestError(cause),
	});
}

function requestInit(
	method: string,
	body: unknown,
	options: ApiRequestOptions,
	accept = "application/json",
): RequestInit | ApiRequestError {
	const hasBody = body !== undefined;
	const encoded = hasBody
		? errore.try({
				try: () => JSON.stringify(body),
				catch: (cause) => new ApiRequestError(cause),
			})
		: null;
	if (encoded instanceof Error) return encoded;
	const headers = requestHeaders({
		body: hasBody,
		headers: options.headers,
		accept,
	});
	if (headers instanceof Error) return headers;
	return {
		method,
		headers,
		credentials: "same-origin",
		...(hasBody ? { body: encoded } : {}),
		...(options.signal ? { signal: options.signal } : {}),
	};
}

export class ApiClient {
	readonly baseUrl: string;
	private readonly fetcher: FetchLike;
	private readonly resourceScope = getResourceScope();

	constructor(options: ApiClientOptions | string = {}) {
		const config = typeof options === "string" ? { baseUrl: options } : options;
		this.baseUrl =
			(config.baseUrl ?? config.apiBaseUrl ?? getApiBaseUrl()).replace(
				/\/+$/,
				"",
			) || DEFAULT_API_BASE_URL;
		this.fetcher = config.fetch ?? globalThis.fetch.bind(globalThis);
	}

	getStatus(options: ApiRequestOptions = {}): Promise<Error | ServerStatus> {
		return this.requestJson<ServerStatus>(
			"status",
			requestInit("GET", undefined, options),
		);
	}

	getModel(
		options: ApiRequestOptions = {},
	): Promise<Error | FinancialModelResponse> {
		return this.requestJson<FinancialModelResponse>(
			"financial-model",
			requestInit("GET", undefined, options),
		);
	}

	getAmountCatalog(
		options: ApiRequestOptions = {},
	): Promise<Error | AmountCatalogResponse> {
		return this.requestJson<AmountCatalogResponse>(
			"amount-resolvers",
			requestInit("GET", undefined, options),
		);
	}

	listAmountPresets(
		options: ApiRequestOptions = {},
	): Promise<Error | AmountPresetListResponse> {
		return this.requestJson<AmountPresetListResponse>(
			"amount-presets",
			requestInit("GET", undefined, options),
		);
	}

	createAmountPreset(
		preset: AmountPreset,
		options: ApiRequestOptions = {},
	): Promise<Error | AmountPresetWriteResponse> {
		return this.requestJson<AmountPresetWriteResponse>(
			"amount-presets",
			requestInit("POST", preset, options),
		);
	}

	updateAmountPreset(
		id: string,
		preset: AmountPreset,
		options: ApiRequestOptions = {},
	): Promise<Error | AmountPresetWriteResponse> {
		return this.requestJson<AmountPresetWriteResponse>(
			`amount-presets/${encodeURIComponent(id)}`,
			requestInit("PATCH", preset, options),
		);
	}

	deleteAmountPreset(
		id: string,
		options: ApiRequestOptions = {},
	): Promise<Error | AmountPresetDeleteResponse> {
		return this.requestJson<AmountPresetDeleteResponse>(
			`amount-presets/${encodeURIComponent(id)}`,
			requestInit("DELETE", undefined, options),
		);
	}

	moveAmountPreset(
		id: string,
		beforeId: string | null,
		options: ApiRequestOptions = {},
	): Promise<Error | AmountPresetMoveResponse> {
		return this.requestJson<AmountPresetMoveResponse>(
			"amount-presets/reorder",
			requestInit("POST", { id, beforeId: beforeId ?? "" }, options),
		);
	}

	projectDeterministic(
		request: DeterministicProjectionRequest,
		options: ApiRequestOptions = {},
	): Promise<Error | DeterministicProjectionResponse> {
		return this.requestJson<DeterministicProjectionResponse>(
			"projections/deterministic",
			requestInit("POST", request, options),
		);
	}

	async projectStochastic(
		request: StochasticProjectionRequest,
		options: ApiRequestOptions = {},
	): Promise<Error | Response> {
		const init = requestInit("POST", request, options, "text/event-stream");
		if (init instanceof Error) return init;
		const scoped = await scopedRequest(
			this.baseUrl,
			path(this.baseUrl, `${API_PREFIX}/projections/stochastic`),
			init,
			this.fetcher,
			this.resourceScope,
		).catch((cause) => new ApiNetworkError(cause));
		if (scoped instanceof Error) return scoped;
		const { response, scope } = scoped;
		if (!response.ok) {
			const error = await parseErrorResponse(response);
			return scopedResponseError(scope, error);
		}
		return response;
	}

	createAccount(
		account: BackendAccount,
		options: ApiRequestOptions = {},
	): Promise<Error | RowWriteResponse<BackendAccount>> {
		return this.requestJson<RowWriteResponse<BackendAccount>>(
			"accounts",
			requestInit("POST", account, options),
		);
	}

	updateAccount(
		id: string,
		account: BackendAccount,
		options: ApiRequestOptions = {},
	): Promise<Error | RowWriteResponse<BackendAccount>> {
		return this.requestJson<RowWriteResponse<BackendAccount>>(
			`accounts/${encodeURIComponent(id)}`,
			requestInit("PATCH", account, options),
		);
	}

	deleteAccount(
		id: string,
		options: ApiRequestOptions = {},
	): Promise<Error | RowDeleteResponse> {
		return this.requestJson<RowDeleteResponse>(
			`accounts/${encodeURIComponent(id)}`,
			requestInit("DELETE", undefined, options),
		);
	}

	moveAccount(
		id: string,
		beforeId: string | null,
		options: ApiRequestOptions = {},
	): Promise<Error | RowDeleteResponse> {
		return this.requestJson<RowDeleteResponse>(
			"accounts/reorder",
			requestInit("POST", { id, beforeId: beforeId ?? "" }, options),
		);
	}

	createPosting(
		posting: BackendPosting,
		options: ApiRequestOptions = {},
	): Promise<Error | RowWriteResponse<BackendPosting>> {
		return this.requestJson<RowWriteResponse<BackendPosting>>(
			"postings",
			requestInit("POST", posting, options),
		);
	}

	updatePosting(
		id: string,
		posting: BackendPosting,
		options: ApiRequestOptions = {},
	): Promise<Error | RowWriteResponse<BackendPosting>> {
		return this.requestJson<RowWriteResponse<BackendPosting>>(
			`postings/${encodeURIComponent(id)}`,
			requestInit("PATCH", posting, options),
		);
	}

	deletePosting(
		id: string,
		options: ApiRequestOptions = {},
	): Promise<Error | RowDeleteResponse> {
		return this.requestJson<RowDeleteResponse>(
			`postings/${encodeURIComponent(id)}`,
			requestInit("DELETE", undefined, options),
		);
	}

	movePosting(
		id: string,
		beforeId: string | null,
		options: ApiRequestOptions = {},
	): Promise<Error | RowDeleteResponse> {
		return this.requestJson<RowDeleteResponse>(
			"postings/reorder",
			requestInit("POST", { id, beforeId: beforeId ?? "" }, options),
		);
	}

	createRule(
		rule: BackendRecurrenceRule,
		options: ApiRequestOptions = {},
	): Promise<Error | RowWriteResponse<BackendRecurrenceRule>> {
		return this.requestJson<RowWriteResponse<BackendRecurrenceRule>>(
			"recurrence-rules",
			requestInit("POST", rule, options),
		);
	}

	updateRule(
		id: string,
		rule: BackendRecurrenceRule,
		options: ApiRequestOptions = {},
	): Promise<Error | RowWriteResponse<BackendRecurrenceRule>> {
		return this.requestJson<RowWriteResponse<BackendRecurrenceRule>>(
			`recurrence-rules/${encodeURIComponent(id)}`,
			requestInit("PATCH", rule, options),
		);
	}

	deleteRule(
		id: string,
		options: ApiRequestOptions = {},
	): Promise<Error | RowDeleteResponse> {
		return this.requestJson<RowDeleteResponse>(
			`recurrence-rules/${encodeURIComponent(id)}`,
			requestInit("DELETE", undefined, options),
		);
	}

	moveRule(
		id: string,
		beforeId: string | null,
		options: ApiRequestOptions = {},
	): Promise<Error | RowDeleteResponse> {
		return this.requestJson<RowDeleteResponse>(
			"recurrence-rules/reorder",
			requestInit("POST", { id, beforeId: beforeId ?? "" }, options),
		);
	}

	saveCheckpoint(
		checkpoint: BackendCheckpoint,
		options: ApiRequestOptions = {},
	): Promise<Error | RowWriteResponse<BackendCheckpoint>> {
		return this.requestJson<RowWriteResponse<BackendCheckpoint>>(
			"checkpoints",
			requestInit("POST", checkpoint, options),
		);
	}

	deleteCheckpoint(
		accountId: string,
		date: string,
		options: ApiRequestOptions = {},
	): Promise<Error | RowDeleteResponse> {
		return this.requestJson<RowDeleteResponse>(
			`checkpoints?accountId=${encodeURIComponent(accountId)}&date=${encodeURIComponent(date)}`,
			requestInit("DELETE", undefined, options),
		);
	}

	createEvaluation(
		item: EvaluationInstance,
		evaluationType: string,
		options: ApiRequestOptions = {},
	): Promise<Error | RowWriteResponse<EvaluationInstance>> {
		return this.requestJson<RowWriteResponse<EvaluationInstance>>(
			"evaluations",
			requestInit("POST", { ...item, type: evaluationType }, options),
		);
	}

	updateEvaluation(
		instanceId: string,
		item: EvaluationInstance,
		evaluationType: string,
		options: ApiRequestOptions = {},
	): Promise<Error | RowWriteResponse<EvaluationInstance>> {
		return this.requestJson<RowWriteResponse<EvaluationInstance>>(
			`evaluations/${encodeURIComponent(instanceId)}`,
			requestInit("PATCH", { ...item, type: evaluationType }, options),
		);
	}

	deleteEvaluation(
		instanceId: string,
		options: ApiRequestOptions = {},
	): Promise<Error | RowDeleteResponse> {
		return this.requestJson<RowDeleteResponse>(
			`evaluations/${encodeURIComponent(instanceId)}`,
			requestInit("DELETE", undefined, options),
		);
	}

	moveEvaluation(
		evaluationType: string,
		instanceId: string,
		beforeId: string | null,
		options: ApiRequestOptions = {},
	): Promise<Error | RowDeleteResponse> {
		return this.requestJson<RowDeleteResponse>(
			"evaluations/reorder",
			requestInit(
				"POST",
				{ type: evaluationType, instanceId, beforeId: beforeId ?? "" },
				options,
			),
		);
	}

	getPinnedEvaluations(
		options: ApiRequestOptions = {},
	): Promise<Error | PinnedEvaluationsResponse> {
		return this.requestJson<PinnedEvaluationsResponse>(
			"pinned-evaluations",
			requestInit("GET", undefined, options),
		);
	}

	setPinnedEvaluations(
		instanceIds: string[],
		options: ApiRequestOptions = {},
	): Promise<Error | PinnedEvaluationsResponse> {
		return this.requestJson<PinnedEvaluationsResponse>(
			"pinned-evaluations",
			requestInit("PUT", { instanceIds }, options),
		);
	}

	private async requestJson<T>(
		route: string,
		init: RequestInit | ApiRequestError,
	): Promise<Error | T> {
		if (init instanceof Error) return init;
		const scoped = await scopedRequest(
			this.baseUrl,
			path(this.baseUrl, `${API_PREFIX}/${route}`),
			init,
			this.fetcher,
			this.resourceScope,
		).catch((cause) => new ApiNetworkError(cause));
		if (scoped instanceof Error) return scoped;
		const { response, scope } = scoped;
		if (!response.ok) {
			const error = await parseErrorResponse(response);
			return scopedResponseError(scope, error);
		}
		const body = await readBody(response);
		const stale = responseScopeError(scope);
		if (stale) return stale;
		if (body instanceof Error) return body;
		if (body.kind === "empty") return null as T;
		if (body.kind !== "json")
			return new ApiParseError(new Error("Expected a JSON response."));
		return body.value as T;
	}
}

export {
	ApiClient as WaypointApiClient,
	ApiClient as WaypointClient,
	ApiClient as FrontendApiClient,
};

export function createApiClient(
	options: ApiClientOptions | string = {},
): ApiClient {
	return new ApiClient(options);
}

export const createClient = createApiClient;

export type StochasticResponseBody = StochasticProjectionResult | ErrorSSEData;
