import fs from "node:fs/promises";
import path from "node:path";
import type { Connect, Plugin, ViteDevServer } from "vite";
import type { FinancialModelParseResult } from "../src/lib/projection/dataSource";
import { parseFinancialModelDocument } from "../src/lib/projection/sources/csv/csvDataSource";
import {
	parseCsvFinancialModel,
	serializeCsvFinancialModel,
} from "../src/lib/projection/sources/csv/csvLoader";
import { validateCsvFinancialModel } from "../src/lib/projection/sources/csv/csvValidation";
import {
	type BehaviorCollectionKey,
	CSV_BEHAVIOR_FILE_NAMES,
	CSV_MODEL_FILE_NAMES,
} from "../src/lib/projection/types/model";

export const FINANCIAL_MODEL_API_PATH = "/api/financial-model";

export interface CsvFilePluginOptions {
	csvPath?: string;
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

async function loadDocument(
	csvPath: string,
): Promise<FinancialModelParseResult> {
	const accounts = await readCsvFile(
		path.join(csvPath, CSV_MODEL_FILE_NAMES.accounts),
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
		{ accounts, behaviors, postings },
		{ basePath: csvPath },
	);

	if (result.data) {
		const issues = validateCsvFinancialModel(result.data);
		return { document: result.data, issues: [...result.issues, ...issues] };
	}

	return { document: null, issues: result.issues };
}

async function saveDocument(
	csvPath: string,
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
	const issues = validateCsvFinancialModel(document);

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

export function csvFilePlugin(options: CsvFilePluginOptions = {}): Plugin {
	let resolvedCsvPath: string;

	return {
		name: "csv-file-plugin",
		apply: "serve",
		configResolved(config) {
			resolvedCsvPath = resolveCsvPath(
				config.root,
				options.csvPath ?? "public/configs",
			);
		},
		configureServer(server: ViteDevServer) {
			const handler: Connect.NextHandleFunction = async (req, res, next) => {
				const send = (status: number, result: FinancialModelParseResult) => {
					res.writeHead(status, { "Content-Type": "application/json" });
					res.end(JSON.stringify(result));
				};

				if (req.method === "GET") {
					try {
						const result = await loadDocument(resolvedCsvPath);
						send(200, result);
					} catch (err) {
						const message =
							err instanceof Error
								? err.message
								: "Failed to load financial model";
						send(500, {
							document: null,
							issues: [
								{ severity: "error", code: "server.load", message, path: [] },
							],
						});
					}
					return;
				}

				if (req.method === "PUT") {
					try {
						const chunks: Buffer[] = [];
						for await (const chunk of req) {
							chunks.push(Buffer.from(chunk));
						}
						const body = JSON.parse(
							Buffer.concat(chunks).toString(),
						) as unknown;
						const result = await saveDocument(resolvedCsvPath, body);
						const hasErrors = result.issues.some(
							(issue) => issue.severity === "error",
						);
						send(hasErrors ? 422 : 200, result);
					} catch (err) {
						const message =
							err instanceof Error
								? err.message
								: "Failed to save financial model";
						send(500, {
							document: null,
							issues: [
								{ severity: "error", code: "server.save", message, path: [] },
							],
						});
					}
					return;
				}

				next();
			};

			server.middlewares.use(FINANCIAL_MODEL_API_PATH, handler);
		},
	};
}
