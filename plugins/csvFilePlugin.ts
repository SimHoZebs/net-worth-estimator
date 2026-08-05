import fs from "node:fs/promises";
import path from "node:path";
import type { Connect, Plugin, ViteDevServer } from "vite";
import type { FinancialModelParseResult } from "../src/lib/projection/dataSource";
import {
	INCOME_DATA_API_PATH,
	INCOME_DATA_FILE_NAMES,
	type IncomeDataLoadResult,
	parseIncomeDataFiles,
	validateCsvFinancialModel,
} from "../src/lib/projection/index";
import { parseFinancialModelDocument } from "../src/lib/projection/sources/csv/csvDataSource";
import {
	parseCsvFinancialModel,
	serializeCsvFinancialModel,
} from "../src/lib/projection/sources/csv/csvLoader";
import {
	type BehaviorCollectionKey,
	CSV_BEHAVIOR_FILE_NAMES,
	CSV_MODEL_FILE_NAMES,
} from "../src/lib/projection/types/model";
import type { ModelValidationIssue } from "../src/lib/projection/types/validation";

export const FINANCIAL_MODEL_API_PATH = "/api/financial-model";
const DEFAULT_MAX_REQUEST_BYTES = 1_048_576;
const INCOME_FILE_NAMES: ReadonlySet<string> = new Set(
	Object.values(INCOME_DATA_FILE_NAMES),
);

export interface CsvFilePluginOptions {
	csvPath?: string;
	incomePath?: string;
	incomeApiPath?: string;
	maxRequestBytes?: number;
}

function resolveCsvPath(projectRoot: string, csvPath: string): string {
	if (path.isAbsolute(csvPath)) return csvPath;
	return path.resolve(projectRoot, csvPath);
}

function readCsvFile(filePath: string): Promise<string> {
	return fs.readFile(filePath, "utf-8");
}

function writeCsvFile(filePath: string, content: string): Promise<void> {
	return fs.writeFile(filePath, content, "utf-8");
}

async function loadIncomeData(
	incomePath: string,
): Promise<IncomeDataLoadResult> {
	try {
		const [incomeSources, taxProfiles] = await Promise.all([
			readCsvFile(path.join(incomePath, INCOME_DATA_FILE_NAMES.incomeSources)),
			readCsvFile(path.join(incomePath, INCOME_DATA_FILE_NAMES.taxProfiles)),
		]);
		return parseIncomeDataFiles({ incomeSources, taxProfiles });
	} catch (error) {
		return {
			data: null,
			issues: [
				{
					severity: "error",
					code: "income-data.load.failed",
					message:
						error instanceof Error
							? error.message
							: "Could not load income data.",
					path: [],
				},
			],
		};
	}
}

async function loadDocument(
	csvPath: string,
	incomePath: string,
): Promise<FinancialModelParseResult> {
	const accounts = await readCsvFile(
		path.join(csvPath, CSV_MODEL_FILE_NAMES.accounts),
	);
	const checkpoints = await readCsvFile(
		path.join(csvPath, CSV_MODEL_FILE_NAMES.checkpoints),
	);
	const postings = await readCsvFile(
		path.join(csvPath, CSV_MODEL_FILE_NAMES.postings),
	);
	const behaviors = Object.fromEntries(
		await Promise.all(
			(
				Object.entries(CSV_BEHAVIOR_FILE_NAMES) as Array<
					[BehaviorCollectionKey, string]
				>
			).map(async ([key, fileName]) => [
				key,
				await readCsvFile(path.join(csvPath, fileName)),
			]),
		),
	) as Record<BehaviorCollectionKey, string>;

	const result = parseCsvFinancialModel(
		{ accounts, behaviors, checkpoints, postings },
		{ basePath: csvPath },
	);
	if (!result.data) return { document: null, issues: result.issues };

	const income = await loadIncomeData(incomePath);
	return {
		document: result.data,
		issues: [
			...result.issues,
			...income.issues,
			...validateCsvFinancialModel(result.data, income.data ?? undefined),
		],
	};
}

async function saveDocument(
	csvPath: string,
	incomePath: string,
	value: unknown,
): Promise<FinancialModelParseResult> {
	const document = parseFinancialModelDocument(value);
	if (!document) {
		return {
			document: null,
			issues: [
				{
					severity: "error",
					code: "document.shape.invalid",
					message: "The financial model document is not canonical.",
					path: [],
				},
			],
		};
	}

	const income = await loadIncomeData(incomePath);
	const issues: ModelValidationIssue[] = [
		...income.issues,
		...validateCsvFinancialModel(document, income.data ?? undefined),
	];
	if (issues.some((issue) => issue.severity === "error")) {
		return { document, issues };
	}

	const files = serializeCsvFinancialModel(document);
	await Promise.all([
		...(
			Object.entries(CSV_MODEL_FILE_NAMES) as Array<
				[keyof typeof CSV_MODEL_FILE_NAMES, string]
			>
		).map(([key, fileName]) =>
			writeCsvFile(path.join(csvPath, fileName), files[key]),
		),
		...(
			Object.entries(CSV_BEHAVIOR_FILE_NAMES) as Array<
				[BehaviorCollectionKey, string]
			>
		).map(([key, fileName]) =>
			writeCsvFile(path.join(csvPath, fileName), files.behaviors[key]),
		),
	]);

	return { document, issues };
}

function errorResult(code: string, message: string): FinancialModelParseResult {
	return {
		document: null,
		issues: [{ severity: "error", code, message, path: [] }],
	};
}

function sendJson(
	res: Parameters<Connect.NextHandleFunction>[1],
	status: number,
	result: FinancialModelParseResult,
): void {
	res.writeHead(status, {
		"Cache-Control": "no-store",
		"Content-Type": "application/json; charset=utf-8",
	});
	res.end(JSON.stringify(result));
}

function isJsonContentType(value: string | string[] | undefined): boolean {
	const contentType = Array.isArray(value) ? value[0] : value;
	return (
		contentType?.split(";", 1)[0]?.trim().toLowerCase() === "application/json"
	);
}

function isLoopback(hostname: string): boolean {
	return (
		hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1"
	);
}

function isAllowedOrigin(
	req: Parameters<Connect.NextHandleFunction>[0],
): boolean {
	const origin = req.headers?.origin;
	if (!origin) return true;
	try {
		const originUrl = new URL(origin);
		const requestHost = req.headers.host;
		if (!requestHost) return false;
		if (originUrl.protocol !== "http:" && originUrl.protocol !== "https:")
			return false;
		if (originUrl.host === requestHost) return true;
		const requestUrl = new URL(`http://${requestHost}`);
		const originPort = originUrl.port || "80";
		const requestPort = requestUrl.port || "80";
		return (
			originPort === requestPort &&
			isLoopback(originUrl.hostname) &&
			isLoopback(requestUrl.hostname)
		);
	} catch {
		return false;
	}
}

async function readRequestBody(
	req: Parameters<Connect.NextHandleFunction>[0],
	maxBytes: number,
): Promise<string | null> {
	const contentLength = Number(req.headers?.["content-length"]);
	if (Number.isFinite(contentLength) && contentLength > maxBytes) return null;

	const chunks: Buffer[] = [];
	let bytes = 0;
	for await (const chunk of req) {
		const buffer = Buffer.from(chunk);
		bytes += buffer.byteLength;
		if (bytes > maxBytes) return null;
		chunks.push(buffer);
	}
	return Buffer.concat(chunks).toString();
}

function incomeFileName(
	req: Parameters<Connect.NextHandleFunction>[0],
	apiPath: string,
) {
	const requestPath = (req.url ?? "").split("?", 1)[0] ?? "";
	const relativePath = requestPath.startsWith(apiPath)
		? requestPath.slice(apiPath.length)
		: requestPath;
	return decodeURIComponent(relativePath.replace(/^\/+/, ""));
}

export function csvFilePlugin(options: CsvFilePluginOptions = {}): Plugin {
	let resolvedCsvPath: string;
	let resolvedIncomePath: string;
	const incomeApiPath = options.incomeApiPath ?? INCOME_DATA_API_PATH;
	const maxRequestBytes = Math.max(
		1,
		options.maxRequestBytes ?? DEFAULT_MAX_REQUEST_BYTES,
	);

	return {
		name: "csv-file-plugin",
		apply: "serve",
		configResolved(config) {
			resolvedCsvPath = resolveCsvPath(
				config.root,
				options.csvPath ?? "public/configs",
			);
			resolvedIncomePath = resolveCsvPath(
				config.root,
				options.incomePath ?? "public/data/income",
			);
		},
		configureServer(server: ViteDevServer) {
			const handler: Connect.NextHandleFunction = async (req, res, next) => {
				if (req.method === "GET") {
					try {
						const result = await loadDocument(
							resolvedCsvPath,
							resolvedIncomePath,
						);
						sendJson(res, 200, result);
					} catch (error) {
						sendJson(
							res,
							500,
							errorResult(
								"server.load",
								error instanceof Error
									? error.message
									: "Failed to load financial model.",
							),
						);
					}
					return;
				}

				if (req.method !== "PUT") {
					next();
					return;
				}
				if (!isAllowedOrigin(req)) {
					sendJson(
						res,
						403,
						errorResult("server.origin", "Request origin is not allowed."),
					);
					return;
				}
				if (!isJsonContentType(req.headers?.["content-type"])) {
					sendJson(
						res,
						415,
						errorResult("server.content_type", "JSON content is required."),
					);
					return;
				}
				try {
					const serialized = await readRequestBody(req, maxRequestBytes);
					if (serialized === null) {
						sendJson(
							res,
							413,
							errorResult(
								"server.body_too_large",
								"Request body is too large.",
							),
						);
						return;
					}
					const result = await saveDocument(
						resolvedCsvPath,
						resolvedIncomePath,
						JSON.parse(serialized) as unknown,
					);
					sendJson(
						res,
						result.issues.some((issue) => issue.severity === "error")
							? 422
							: 200,
						result,
					);
				} catch (error) {
					sendJson(
						res,
						400,
						errorResult(
							"server.save",
							error instanceof Error
								? error.message
								: "Failed to save financial model.",
						),
					);
				}
			};

			const incomeHandler: Connect.NextHandleFunction = async (
				req,
				res,
				next,
			) => {
				if (req.method !== "GET") {
					next();
					return;
				}
				try {
					const fileName = incomeFileName(req, incomeApiPath);
					if (!INCOME_FILE_NAMES.has(fileName)) {
						next();
						return;
					}
					const content = await readCsvFile(
						path.join(resolvedIncomePath, fileName),
					);
					res.writeHead(200, {
						"Cache-Control": "no-store",
						"Content-Type": "text/csv; charset=utf-8",
					});
					res.end(content);
				} catch {
					next();
				}
			};

			server.middlewares.use(FINANCIAL_MODEL_API_PATH, handler);
			server.middlewares.use(incomeApiPath, incomeHandler);
		},
	};
}
