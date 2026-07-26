import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { Connect, ResolvedConfig, ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinancialModelDocument } from "../src/lib/projection/types/model";
import {
	csvFilePlugin,
	FINANCIAL_MODEL_API_PATH,
	LEGACY_SCENARIO_PACK_API_PATH,
} from "./csvFilePlugin";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirectories
			.splice(0)
			.map((directory) => fs.rm(directory, { recursive: true, force: true })),
	);
});

async function createHarness(csvPath?: string) {
	const handlers = new Map<string, Connect.NextHandleFunction>();
	const use = vi.fn((route: string, handler: Connect.NextHandleFunction) => {
		handlers.set(route, handler);
	});
	const plugin = csvFilePlugin({ csvPath: csvPath ?? "public/configs" });
	const configure = plugin.configResolved as (config: ResolvedConfig) => void;
	const configureServer = plugin.configureServer as (
		server: ViteDevServer,
	) => void;
	configure({ root: path.resolve(".") } as ResolvedConfig);
	configureServer({ middlewares: { use } } as unknown as ViteDevServer);

	const invoke = async (
		route: string,
		method: "GET" | "PUT",
		body?: unknown,
	) => {
		const handler = handlers.get(route);
		if (!handler) throw new Error(`Missing handler for ${route}`);
		let responseBody = "";
		let status = 0;
		const response = {
			writeHead: vi.fn((value: number) => {
				status = value;
			}),
			end: vi.fn((value: string) => {
				responseBody = value;
			}),
		} as unknown as ServerResponse;
		const request = Object.assign(
			Readable.from(body === undefined ? [] : [JSON.stringify(body)]),
			{ method },
		) as IncomingMessage;

		await handler(request, response, vi.fn());
		return {
			status,
			body: JSON.parse(responseBody) as Record<string, unknown>,
		};
	};

	return { handlers, invoke };
}

async function createFixtureDirectory() {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "csv-plugin-"));
	tempDirectories.push(directory);
	await fs.cp(path.resolve("public/configs"), directory, { recursive: true });
	return directory;
}

describe("csvFilePlugin", () => {
	it("registers both routes and preserves their distinct GET envelopes", async () => {
		const { handlers, invoke } = await createHarness();

		expect([...handlers.keys()]).toEqual([
			FINANCIAL_MODEL_API_PATH,
			LEGACY_SCENARIO_PACK_API_PATH,
		]);

		const canonical = await invoke(FINANCIAL_MODEL_API_PATH, "GET");
		const legacy = await invoke(LEGACY_SCENARIO_PACK_API_PATH, "GET");

		expect(canonical).toMatchObject({
			status: 200,
			body: { document: expect.any(Object), issues: [] },
		});
		expect(canonical.body).not.toHaveProperty("pack");
		const document = canonical.body.document as FinancialModelDocument;
		expect(
			document.evaluations.financialIndependence[0]?.config.sources,
		).toEqual([
			{ type: "asset", accountId: "k401", included: true },
			{ type: "asset", accountId: "brokerage", included: true },
			{ type: "asset", accountId: "roth_ira", included: true },
			{ type: "asset", accountId: "rsu_vested", included: true },
		]);
		expect(
			document.evaluations.financialIndependence[0]?.config
				.continuingPostingIds,
		).toEqual([
			"k401_growth",
			"brokerage_growth",
			"roth_ira_growth",
			"rsu_vested_growth",
		]);
		const fi = document.evaluations.financialIndependence[0]!.config;
		const accountIds = new Set(document.accounts.map(({ id }) => id));
		const postingIds = new Set(document.postings.map(({ id }) => id));
		expect(
			fi.sources.every((source) =>
				source.type === "asset"
					? accountIds.has(source.accountId)
					: postingIds.has(source.postingId),
			),
		).toBe(true);
		expect(fi.continuingPostingIds.every((id) => postingIds.has(id))).toBe(
			true,
		);
		expect(legacy).toMatchObject({
			status: 200,
			body: { pack: expect.any(Object), issues: [] },
		});
		expect(legacy.body).not.toHaveProperty("document");
	});

	it("preserves the route envelope for load errors", async () => {
		const missingPath = path.join(os.tmpdir(), "missing-csv-plugin-fixture");
		const { invoke } = await createHarness(missingPath);

		const canonical = await invoke(FINANCIAL_MODEL_API_PATH, "GET");
		const legacy = await invoke(LEGACY_SCENARIO_PACK_API_PATH, "GET");

		expect(canonical).toMatchObject({
			status: 500,
			body: { document: null, issues: [{ code: "server.load" }] },
		});
		expect(legacy).toMatchObject({
			status: 500,
			body: { pack: null, issues: [{ code: "server.load" }] },
		});
	});

	it("does not write invalid PUT bodies and returns diagnostics", async () => {
		const directory = await createFixtureDirectory();
		const { invoke } = await createHarness(directory);
		const loaded = await invoke(FINANCIAL_MODEL_API_PATH, "GET");
		const document = loaded.body.document as FinancialModelDocument;
		const accountsPath = path.join(directory, "accounts.csv");
		const before = await fs.readFile(accountsPath, "utf-8");
		const invalid = {
			...document,
			accounts: [...document.accounts, document.accounts[0]],
		};

		const response = await invoke(
			LEGACY_SCENARIO_PACK_API_PATH,
			"PUT",
			invalid,
		);

		expect(response).toMatchObject({
			status: 422,
			body: {
				pack: invalid,
				issues: [{ severity: "error", code: "account.id.duplicate" }],
			},
		});
		expect(response.body).not.toHaveProperty("document");
		expect(await fs.readFile(accountsPath, "utf-8")).toBe(before);
	});

	it("writes warning-only documents and returns 200", async () => {
		const directory = await createFixtureDirectory();
		const { invoke } = await createHarness(directory);
		const loaded = await invoke(FINANCIAL_MODEL_API_PATH, "GET");
		const document = loaded.body.document as FinancialModelDocument;
		const warningDocument = {
			...document,
			accounts: document.accounts.map((account, index) =>
				index === 0 ? { ...account, color: null } : account,
			),
		};

		const response = await invoke(
			FINANCIAL_MODEL_API_PATH,
			"PUT",
			warningDocument,
		);

		expect(response).toMatchObject({
			status: 200,
			body: {
				document: warningDocument,
				issues: [{ severity: "warning", code: "account.color.missing" }],
			},
		});
		const saved = await fs.readFile(
			path.join(directory, "accounts.csv"),
			"utf-8",
		);
		expect(saved).toContain(`${warningDocument.accounts[0].id},`);
	});
});
