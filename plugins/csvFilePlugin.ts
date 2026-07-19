import fs from "node:fs/promises";
import path from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import type { ScenarioParseResult } from "../src/lib/projection/dataSource";
import {
	parseCsvScenarioPack,
	serializeCsvScenarioPack,
} from "../src/lib/projection/sources/csv/csvLoader";
import { validateCsvScenarioPack } from "../src/lib/projection/sources/csv/csvValidation";
import {
	type BehaviorCollectionKey,
	CSV_BEHAVIOR_FILE_NAMES,
	CSV_SCENARIO_FILE_NAMES,
	type ScenarioPack,
} from "../src/lib/projection/types/scenario";

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

async function loadPack(csvPath: string): Promise<ScenarioParseResult> {
	const accounts = await readCsvFile(
		path.join(csvPath, CSV_SCENARIO_FILE_NAMES.accounts),
	);
	const checkpoints = await readCsvFile(
		path.join(csvPath, CSV_SCENARIO_FILE_NAMES.checkpoints),
	);
	const postings = await readCsvFile(
		path.join(csvPath, CSV_SCENARIO_FILE_NAMES.postings),
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

	const result = parseCsvScenarioPack(
		{ accounts, behaviors, checkpoints, postings },
		{ basePath: csvPath },
	);

	if (result.data) {
		const issues = validateCsvScenarioPack(result.data);
		return { pack: result.data, issues: [...result.issues, ...issues] };
	}

	return { pack: null, issues: result.issues };
}

async function savePack(
	csvPath: string,
	pack: ScenarioPack,
): Promise<ScenarioParseResult> {
	const issues = validateCsvScenarioPack(pack);

	if (issues.length > 0) {
		return { pack, issues };
	}

	const files = serializeCsvScenarioPack(pack);

	await Promise.all([
		...(
			Object.entries(CSV_SCENARIO_FILE_NAMES) as Array<
				[keyof typeof CSV_SCENARIO_FILE_NAMES, string]
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

	return { pack, issues };
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
			server.middlewares.use("/api/scenario/pack", async (req, res, next) => {
				if (req.method === "GET") {
					try {
						const result = await loadPack(resolvedCsvPath);
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify(result));
					} catch (err) {
						const message =
							err instanceof Error
								? err.message
								: "Failed to load scenario pack";
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(
							JSON.stringify({
								pack: null,
								issues: [
									{ severity: "error", code: "server.load", message, path: [] },
								],
							}),
						);
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
						) as ScenarioPack;
						const result = await savePack(resolvedCsvPath, body);
						res.writeHead(200, { "Content-Type": "application/json" });
						res.end(JSON.stringify(result));
					} catch (err) {
						const message =
							err instanceof Error
								? err.message
								: "Failed to save scenario pack";
						res.writeHead(500, { "Content-Type": "application/json" });
						res.end(
							JSON.stringify({
								pack: null,
								issues: [
									{ severity: "error", code: "server.save", message, path: [] },
								],
							}),
						);
					}
					return;
				}

				next();
			});
		},
	};
}
