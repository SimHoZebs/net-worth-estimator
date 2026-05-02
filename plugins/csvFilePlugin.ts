import path from "path";
import fs from "fs/promises";
import type { Plugin, ViteDevServer } from "vite";
import { parseCsvScenarioPack, serializeCsvScenarioPack } from "../src/lib/projection/sources/csv/csvLoader";
import { validateCsvScenarioPack } from "../src/lib/projection/sources/csv/csvValidation";
import type { ScenarioPack } from "../src/lib/projection/types/scenario";
import type { ScenarioParseResult } from "../src/lib/projection/dataSource";

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
  const accounts = await readCsvFile(path.join(csvPath, "accounts.csv"));
  const checkpoints = await readCsvFile(path.join(csvPath, "checkpoints.csv"));
  const postings = await readCsvFile(path.join(csvPath, "postings.csv"));

  const result = parseCsvScenarioPack({ accounts, checkpoints, postings }, { basePath: csvPath });

  if (result.data) {
    const issues = validateCsvScenarioPack(result.data);
    return { pack: result.data, issues: [...result.issues, ...issues] };
  }

  return { pack: null, issues: result.issues };
}

async function savePack(csvPath: string, pack: ScenarioPack): Promise<ScenarioParseResult> {
  const issues = validateCsvScenarioPack(pack);

  if (issues.length > 0) {
    return { pack, issues };
  }

  const files = serializeCsvScenarioPack(pack);

  await writeCsvFile(path.join(csvPath, "accounts.csv"), files.accounts);
  await writeCsvFile(path.join(csvPath, "checkpoints.csv"), files.checkpoints);
  await writeCsvFile(path.join(csvPath, "postings.csv"), files.postings);

  return { pack, issues };
}

export function csvFilePlugin(options: CsvFilePluginOptions = {}): Plugin {
  let resolvedCsvPath: string;

  return {
    name: "csv-file-plugin",
    apply: "serve",
    configResolved(config) {
      resolvedCsvPath = resolveCsvPath(config.root, options.csvPath ?? "public/scenario");
    },
    configureServer(server: ViteDevServer) {
      server.middlewares.use("/api/scenario/pack", async (req, res, next) => {
        if (req.method === "GET") {
          try {
            const result = await loadPack(resolvedCsvPath);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to load scenario pack";
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ pack: null, issues: [{ severity: "error", code: "server.load", message, path: [] }] }));
          }
          return;
        }

        if (req.method === "PUT") {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(Buffer.from(chunk));
            }
            const body = JSON.parse(Buffer.concat(chunks).toString()) as ScenarioPack;
            const result = await savePack(resolvedCsvPath, body);
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify(result));
          } catch (err) {
            const message = err instanceof Error ? err.message : "Failed to save scenario pack";
            res.writeHead(500, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ pack: null, issues: [{ severity: "error", code: "server.save", message, path: [] }] }));
          }
          return;
        }

        next();
      });
    },
  };
}
