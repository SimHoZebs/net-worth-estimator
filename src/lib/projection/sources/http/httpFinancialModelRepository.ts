import { buildApiUrl } from "@/lib/apiUrl";
import {
	type FinancialModelParseResult,
	type FinancialModelRepository,
	FinancialModelValidationError,
} from "../../modelRepository";
import type { FinancialModelDocument } from "../../types/model";
import type { ModelValidationIssue } from "../../types/validation";
import { parseFinancialModelDocument } from "./documentParser";

// HTTP repository backed by the Go backend (chi + huma + SQLite). The backend
// is the canonical persistence; see docs/backend-migration/ASSUMPTIONS.md A1.

export const FINANCIAL_MODEL_HTTP_API_PATH = buildApiUrl("/v1/financial-model");
export const SERVER_STATUS_API_PATH = buildApiUrl("/v1/status");

export interface ServerStatus {
	readOnly: boolean;
	authEnabled: boolean;
}

export interface HttpFinancialModelRepositoryOptions {
	basePath?: string;
	fetchImpl?: typeof fetch;
	/** Returns the bearer token for writes, or null when unsigned in. */
	getAuthToken?: () => string | null;
}

function defaultFetch(): typeof fetch {
	return fetch.bind(globalThis);
}

interface ParseResultBody {
	document: FinancialModelDocument | null;
	issues: ModelValidationIssue[];
}

function toParseResult(body: ParseResultBody): FinancialModelParseResult {
	const document = body.document
		? parseFinancialModelDocument(body.document)
		: null;
	return { document, issues: body.issues ?? [] };
}

async function requestModel(
	fetchImpl: typeof fetch,
	basePath: string,
	init?: RequestInit,
): Promise<FinancialModelParseResult> {
	const response = await fetchImpl(basePath, init);
	if (!response.ok) {
		throw new HttpStatusError(
			response.status,
			`Financial model request failed (${response.status}).`,
		);
	}
	const body = (await response.json()) as ParseResultBody;
	return toParseResult(body);
}

export class HttpStatusError extends Error {
	readonly status: number;

	constructor(status: number, message: string) {
		super(message);
		this.name = "HttpStatusError";
		this.status = status;
	}
}

export function createHttpFinancialModelRepository(
	options: HttpFinancialModelRepositoryOptions = {},
): FinancialModelRepository {
	const basePath = options.basePath ?? FINANCIAL_MODEL_HTTP_API_PATH;
	const fetchImpl = options.fetchImpl ?? defaultFetch();
	const getAuthToken = options.getAuthToken ?? (() => null);
	return {
		repositoryType: "http-backend",
		label: "Backend",
		description:
			"The Go backend stores the canonical financial model in SQLite.",
		loadDocument() {
			return requestModel(fetchImpl, basePath);
		},
		save: {
			label: "Save",
			description: "Validate and persist changes in the backend database.",
			async run(document: FinancialModelDocument) {
				try {
					const token = getAuthToken();
					return await requestModel(fetchImpl, basePath, {
						method: "PUT",
						headers: {
							"Content-Type": "application/json",
							...(token ? { Authorization: `Bearer ${token}` } : {}),
						},
						body: JSON.stringify(document),
					});
				} catch (error) {
					if (error instanceof FinancialModelValidationError) throw error;
					if (error instanceof HttpStatusError && error.status === 401) {
						throw new Error(
							"Backend rejected the save (401): missing or invalid access token. Set it in Settings.",
						);
					}
					if (error instanceof HttpStatusError && error.status === 403) {
						throw new Error(
							"Backend rejected the save (403): the server is read-only.",
						);
					}
					throw new Error(
						error instanceof Error
							? error.message
							: "Could not save the financial model.",
					);
				}
			},
		},
	};
}

/**
 * Fetch the backend write-availability status. Callers should treat failure
 * as unknown (leave write UI visible); the server enforces read-only itself.
 */
export async function fetchServerStatus(
	fetchImpl: typeof fetch = defaultFetch(),
	statusPath: string = SERVER_STATUS_API_PATH,
): Promise<ServerStatus> {
	const response = await fetchImpl(statusPath);
	if (!response.ok) {
		throw new Error(`Server status request failed (${response.status}).`);
	}
	const body = (await response.json()) as Partial<ServerStatus>;
	return {
		readOnly: body.readOnly === true,
		authEnabled: body.authEnabled === true,
	};
}

/**
 * Return the repository without write capabilities so Save UI hides
 * when the server reports read-only.
 */
export function withoutWriteCapabilities(
	repository: FinancialModelRepository,
): FinancialModelRepository {
	return { ...repository, save: undefined, reset: undefined };
}
