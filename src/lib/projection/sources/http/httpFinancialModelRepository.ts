import { buildApiUrl } from "@/lib/api-url";
import {
	type FinancialModelParseResult,
	type FinancialModelRepository,
	FinancialModelValidationError,
} from "../../modelRepository";
import type { FinancialModelDocument } from "../../types/model";
import type { ModelValidationIssue } from "../../types/validation";
import { parseFinancialModelDocument } from "../csv/csvDataSource";

// HTTP repository backed by the Go backend (chi + huma + SQLite). The backend
// is the canonical persistence; see docs/backend-migration/ASSUMPTIONS.md A1.

export const FINANCIAL_MODEL_HTTP_API_PATH = buildApiUrl("/v1/financial-model");

export interface HttpFinancialModelRepositoryOptions {
	basePath?: string;
	fetchImpl?: typeof fetch;
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
		throw new Error(`Financial model request failed (${response.status}).`);
	}
	const body = (await response.json()) as ParseResultBody;
	return toParseResult(body);
}

export function createHttpFinancialModelRepository(
	options: HttpFinancialModelRepositoryOptions = {},
): FinancialModelRepository {
	const basePath = options.basePath ?? FINANCIAL_MODEL_HTTP_API_PATH;
	const fetchImpl = options.fetchImpl ?? defaultFetch();
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
					return await requestModel(fetchImpl, basePath, {
						method: "PUT",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify(document),
					});
				} catch (error) {
					if (error instanceof FinancialModelValidationError) throw error;
					throw new Error(
						error instanceof Error
							? error.message
							: "Could not save the financial model.",
					);
				}
			},
		},
		reset: {
			label: "Reset",
			description: "Restore the bundled source data through the backend.",
			async run() {
				const response = await fetchImpl(`${basePath}/reset`, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
				});
				if (!response.ok) {
					throw new Error(`Reset failed (${response.status}).`);
				}
				const body = (await response.json()) as {
					result?: ParseResultBody | null;
				};
				if (!body.result) {
					throw new Error("Reset returned no model snapshot.");
				}
				return toParseResult(body.result);
			},
		},
	};
}
