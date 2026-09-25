import * as errore from "errore";
import type {
	DeterministicProjectionRequest,
	DeterministicProjectionResponse,
	ErrorSSEData,
	FinancialModelDocument,
	FinancialModelResponse,
	IncomeDataSnapshot,
	ProblemDetails,
	ServerStatus,
	SimpleFINSummary,
	StochasticProjectionRequest,
	StochasticProjectionResult,
} from "./contracts.ts";
import { getApiBaseUrl } from "./runtime.ts";

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
	authToken?: string;
	bearerToken?: string;
	token?: string;
	ifMatch?: string;
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
		return `Authentication is required. Provide a valid bearer token for this request.${suffix}`;
	if (status === 403)
		return `The server is read-only. Enable writes on the server before saving.${suffix}`;
	if (status === 409)
		return `The server could not start this request because it is already in progress.${suffix}`;
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
	authToken,
	bearerToken,
	token,
	ifMatch,
	headers,
	accept,
}: {
	body: boolean;
	authToken?: string;
	bearerToken?: string;
	token?: string;
	ifMatch?: string;
	headers?: HeadersInit;
	accept: string;
}): Headers | ApiRequestError {
	return errore.try({
		try: () => {
			const result = new Headers(headers);
			if (body && !result.has("content-type"))
				result.set("content-type", "application/json");
			if (!result.has("accept")) result.set("accept", accept);
			const suppliedToken = authToken ?? bearerToken ?? token;
			if (suppliedToken) result.set("authorization", `Bearer ${suppliedToken}`);
			if (ifMatch) result.set("if-match", ifMatch);
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
		authToken: options.authToken,
		bearerToken: options.bearerToken,
		token: options.token,
		ifMatch: options.ifMatch,
		headers: options.headers,
		accept,
	});
	if (headers instanceof Error) return headers;
	return {
		method,
		headers,
		...(hasBody ? { body: encoded } : {}),
		...(options.signal ? { signal: options.signal } : {}),
	};
}

export class ApiClient {
	readonly baseUrl: string;
	private readonly fetcher: FetchLike;

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

	getIncomeData(
		options: ApiRequestOptions = {},
	): Promise<Error | IncomeDataSnapshot> {
		return this.requestJson<IncomeDataSnapshot>(
			"income-data",
			requestInit("GET", undefined, options),
		);
	}

	putModel(
		document: FinancialModelDocument,
		options: ApiRequestOptions = {},
	): Promise<Error | FinancialModelResponse> {
		return this.requestJson<FinancialModelResponse>(
			"financial-model",
			requestInit("PUT", document, options),
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
		const response = await this.fetcher(
			path(this.baseUrl, `${API_PREFIX}/projections/stochastic`),
			init,
		).catch((cause) => new ApiNetworkError(cause));
		if (response instanceof Error) return response;
		if (!response.ok) return parseErrorResponse(response);
		return response;
	}

	triggerSimpleFIN(
		options: ApiRequestOptions = {},
	): Promise<Error | SimpleFINSummary> {
		return this.requestJson<SimpleFINSummary>(
			"sync/simplefin",
			requestInit("POST", undefined, options),
		);
	}

	private async requestJson<T>(
		route: string,
		init: RequestInit | ApiRequestError,
	): Promise<Error | T> {
		if (init instanceof Error) return init;
		const response = await this.fetcher(
			path(this.baseUrl, `${API_PREFIX}/${route}`),
			init,
		).catch((cause) => new ApiNetworkError(cause));
		if (response instanceof Error) return response;
		if (!response.ok) return parseErrorResponse(response);
		const body = await readBody(response);
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
