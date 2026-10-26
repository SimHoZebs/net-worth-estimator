import * as errore from "errore";
import { isRecord } from "@/domain/guards.ts";
import type { ProblemDetails } from "@/api/contracts.ts";

export type FetchLike = (
	input: RequestInfo | URL,
	init?: RequestInit,
) => Promise<Response>;

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

// WWW-Authenticate scheme is case-insensitive per RFC 9110; challenge may
// carry params like `Session realm="waypoint"`.
function authScheme(value: string | null): string {
	if (!value) return "";
	return (
		value
			.split(/[\s;,]/, 1)[0]
			?.trim()
			.toLowerCase() ?? ""
	);
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
		authScheme(response.headers.get("www-authenticate")) === "session" &&
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
