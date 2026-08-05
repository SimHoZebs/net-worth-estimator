import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import type { Connect, ResolvedConfig, ViteDevServer } from "vite";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	parseIncomeDataFiles,
	prepareSimulationRequest,
} from "../src/lib/projection";
import {
	INCOME_DATA_API_PATH,
	INCOME_DATA_FILE_NAMES,
} from "../src/lib/projection/types/income";
import type { FinancialModelDocument } from "../src/lib/projection/types/model";
import { csvFilePlugin, FINANCIAL_MODEL_API_PATH } from "./csvFilePlugin";

const tempDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		tempDirectories
			.splice(0)
			.map((directory) => fs.rm(directory, { recursive: true, force: true })),
	);
});

async function createHarness(
	csvPath?: string,
	pluginOptions: { incomePath?: string; maxRequestBytes?: number } = {},
) {
	const handlers = new Map<string, Connect.NextHandleFunction>();
	const use = vi.fn((route: string, handler: Connect.NextHandleFunction) => {
		handlers.set(route, handler);
	});
	const plugin = csvFilePlugin({
		csvPath: csvPath ?? "public/configs",
		...pluginOptions,
	});
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
		options: { headers?: Record<string, string> } = {},
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
			{
				method,
				headers: {
					host: "localhost:5173",
					...(method === "PUT" ? { "content-type": "application/json" } : {}),
					...options.headers,
				},
			},
		) as IncomingMessage;

		await handler(request, response, vi.fn());
		return {
			status,
			body: JSON.parse(responseBody) as Record<string, unknown>,
		};
	};
	const invokeIncome = async (fileName: string) => {
		const handler = handlers.get(INCOME_DATA_API_PATH);
		if (!handler) throw new Error("Missing income data handler");
		let responseBody = "";
		const response = {
			writeHead: vi.fn(),
			end: vi.fn((value: string) => {
				responseBody = value;
			}),
		} as unknown as ServerResponse;
		const request = Object.assign(Readable.from([]), {
			method: "GET",
			url: `${INCOME_DATA_API_PATH}/${fileName}`,
			headers: { host: "localhost:5173" },
		}) as IncomingMessage;
		await handler(request, response, vi.fn());
		return responseBody;
	};

	return { handlers, invoke, invokeIncome };
}

async function createFixtureDirectory() {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), "csv-plugin-"));
	tempDirectories.push(directory);
	await fs.cp(path.resolve("public/configs"), directory, { recursive: true });
	return directory;
}

describe("csvFilePlugin", () => {
	it("registers the canonical route and returns its GET envelope", async () => {
		const { handlers, invoke, invokeIncome } = await createHarness();

		expect([...handlers.keys()]).toEqual([
			FINANCIAL_MODEL_API_PATH,
			INCOME_DATA_API_PATH,
		]);

		const canonical = await invoke(FINANCIAL_MODEL_API_PATH, "GET");
		const incomeCsv = await invokeIncome("income-sources.csv");
		expect(incomeCsv).toContain(
			"id,label,effectiveFrom,effectiveTo,annualGrossIncome",
		);

		expect(canonical).toMatchObject({
			status: 200,
			body: { document: expect.any(Object), issues: [] },
		});
		expect(canonical.body).not.toHaveProperty("pack");
		const document = canonical.body.document as FinancialModelDocument;
		expect(document.checkpoints).not.toHaveLength(0);
		const incomeDataResult = parseIncomeDataFiles({
			incomeSources: await fs.readFile(
				path.join("public/data/income", INCOME_DATA_FILE_NAMES.incomeSources),
				"utf-8",
			),
			taxProfiles: await fs.readFile(
				path.join("public/data/income", INCOME_DATA_FILE_NAMES.taxProfiles),
				"utf-8",
			),
		});
		if (!incomeDataResult.data) throw new Error("Income fixture is invalid.");
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
		const prepared = prepareSimulationRequest(
			document,
			{
				fallbackProjectionStartDate: "2026-07-28",
				horizonYears: 1,
				evaluations: document.evaluations,
			},
			undefined,
			undefined,
			incomeDataResult.data,
		);
		const expectedOpeningBalances = {
			checking: 397.74,
			k401: 1260.74,
			roth_ira: 1112.57,
			sofi_loan_principal: -36417.58,
			sofi_loan_interest: -66.35,
		};
		for (const [accountId, expectedBalance] of Object.entries(
			expectedOpeningBalances,
		)) {
			expect(prepared.request.initialState.balances[accountId]).toBeCloseTo(
				expectedBalance,
				8,
			);
		}
		const enabledAccountIds = new Set(
			document.accounts
				.filter((account) => account.enabled)
				.map((account) => account.id),
		);
		const openingNetWorth = Object.entries(
			prepared.request.initialState.balances,
		).reduce(
			(total, [accountId, balance]) =>
				total + (enabledAccountIds.has(accountId) ? balance : 0),
			0,
		);
		expect(Number.isFinite(openingNetWorth)).toBe(true);
	});

	it("preserves the canonical envelope for load errors", async () => {
		const missingPath = path.join(os.tmpdir(), "missing-csv-plugin-fixture");
		const { invoke } = await createHarness(missingPath);

		const canonical = await invoke(FINANCIAL_MODEL_API_PATH, "GET");

		expect(canonical).toMatchObject({
			status: 500,
			body: { document: null, issues: [{ code: "server.load" }] },
		});
	});

	it("retains the model when income files cannot be loaded", async () => {
		const directory = await createFixtureDirectory();
		const { invoke } = await createHarness(directory, {
			incomePath: path.join(directory, "missing-income"),
		});

		const canonical = await invoke(FINANCIAL_MODEL_API_PATH, "GET");

		expect(canonical).toMatchObject({
			status: 200,
			body: {
				document: expect.any(Object),
				issues: [{ code: "income-data.load.failed", severity: "error" }],
			},
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

		const response = await invoke(FINANCIAL_MODEL_API_PATH, "PUT", invalid);

		expect(response).toMatchObject({
			status: 422,
			body: {
				document: invalid,
				issues: [{ severity: "error", code: "account.id.duplicate" }],
			},
		});
		expect(await fs.readFile(accountsPath, "utf-8")).toBe(before);
	});

	it("does not write an invalid FI expense basis", async () => {
		const directory = await createFixtureDirectory();
		const { invoke } = await createHarness(directory);
		const loaded = await invoke(FINANCIAL_MODEL_API_PATH, "GET");
		const document = loaded.body.document as FinancialModelDocument;
		const behaviorPath = path.join(
			directory,
			"behavior",
			"financial-independence.csv",
		);
		const before = await fs.readFile(behaviorPath, "utf-8");
		const invalid = structuredClone(document) as unknown as {
			evaluations: {
				financialIndependence: Array<{ config: Record<string, unknown> }>;
			};
		};
		invalid.evaluations
			.financialIndependence[0]!.config.annualExpenseTargetBasis =
			"future-dollars";

		const response = await invoke(FINANCIAL_MODEL_API_PATH, "PUT", invalid);

		expect(response).toMatchObject({
			status: 422,
			body: { issues: [{ code: "document.shape.invalid" }] },
		});
		expect(await fs.readFile(behaviorPath, "utf-8")).toBe(before);
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

	it("writes checkpoint edits through the canonical API", async () => {
		const directory = await createFixtureDirectory();
		const { invoke } = await createHarness(directory);
		const loaded = await invoke(FINANCIAL_MODEL_API_PATH, "GET");
		const document = loaded.body.document as FinancialModelDocument;
		const checkpoint = document.checkpoints[0]!;
		const edited = {
			...document,
			checkpoints: [
				{ ...checkpoint, Balance: checkpoint.Balance + 1 },
				...document.checkpoints.slice(1),
			],
		};

		const response = await invoke(FINANCIAL_MODEL_API_PATH, "PUT", edited);

		expect(response.status).toBe(200);
		expect(
			await fs.readFile(path.join(directory, "checkpoints.csv"), "utf-8"),
		).toContain(
			`${checkpoint.Date},${checkpoint.AccountId},${checkpoint.Balance + 1}`,
		);
	});

	it("rejects noncanonical document fields without writing files", async () => {
		const directory = await createFixtureDirectory();
		const { invoke } = await createHarness(directory);
		const loaded = await invoke(FINANCIAL_MODEL_API_PATH, "GET");
		const accountsPath = path.join(directory, "accounts.csv");
		const before = await fs.readFile(accountsPath, "utf-8");
		const noncanonical = {
			...(loaded.body.document as FinancialModelDocument),
			unexpected: true,
		};

		const response = await invoke(
			FINANCIAL_MODEL_API_PATH,
			"PUT",
			noncanonical,
		);

		expect(response).toMatchObject({
			status: 422,
			body: { issues: [{ code: "document.shape.invalid" }] },
		});
		expect(await fs.readFile(accountsPath, "utf-8")).toBe(before);
	});

	it("rejects non-JSON writes before reading the body", async () => {
		const directory = await createFixtureDirectory();
		const { invoke } = await createHarness(directory);
		const response = await invoke(
			FINANCIAL_MODEL_API_PATH,
			"PUT",
			{},
			{ headers: { "content-type": "text/plain" } },
		);

		expect(response).toMatchObject({
			status: 415,
			body: { issues: [{ code: "server.content_type" }] },
		});
	});

	it("rejects cross-origin writes", async () => {
		const directory = await createFixtureDirectory();
		const { invoke } = await createHarness(directory);
		const response = await invoke(
			FINANCIAL_MODEL_API_PATH,
			"PUT",
			{},
			{ headers: { origin: "https://evil.example" } },
		);

		expect(response).toMatchObject({
			status: 403,
			body: { issues: [{ code: "server.origin" }] },
		});
	});

	it("rejects oversized writes", async () => {
		const directory = await createFixtureDirectory();
		const { invoke } = await createHarness(directory, { maxRequestBytes: 16 });
		const response = await invoke(FINANCIAL_MODEL_API_PATH, "PUT", {
			payload: "12345678901234567890",
		});

		expect(response).toMatchObject({
			status: 413,
			body: { issues: [{ code: "server.body_too_large" }] },
		});
	});
});
