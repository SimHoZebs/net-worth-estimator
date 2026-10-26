import { vi } from "vitest";
import type {
	FinancialModelDocument,
	FinancialModelResponse,
} from "../api/index.ts";
import { ok } from "./fetch.ts";

// Single home for the workspace fetch fake. Migration left a copy of this
// server inside remoteHooks.test.ts and smaller variants in other test
// files; extend this module instead of adding another local stub.

export function modelFixture(): FinancialModelDocument {
	return {
		sourcePath: "/configs/household.json",
		accounts: [
			{
				id: "cash",
				name: "Cash",
				kind: "cash",
				minBalance: 0,
				maxBalance: null,
				color: null,
				enabled: true,
			},
			{
				id: "loan",
				name: "Loan",
				kind: "debt",
				minBalance: 0,
				maxBalance: null,
				color: null,
				enabled: true,
			},
		],
		checkpoints: [
			{ Date: "2026-01-31", AccountId: "cash", Balance: 100 },
			{ Date: "2026-01-31", AccountId: "loan", Balance: -40 },
		],
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [
				{
					instanceId: "target",
					name: "Reach target",
					enabled: true,
					config: { target: 500 },
				},
			],
			accountBalance: [],
			postingFulfillment: [],
		},
		postings: [],
		recurrenceRules: [
			{
				id: "salary",
				name: "Salary",
				sourceAccountId: null,
				destinations: ["cash"],
				amount: { resolver: "expression", config: { expression: "100" } },
				frequency: "monthly",
				startDate: "2026-02-01",
				endDate: null,
				annualCap: null,
				priority: 1,
				enabled: true,
			},
		],
	};
}

export type PutCallback = (
	document: FinancialModelDocument,
) => Error | FinancialModelResponse;

export interface TestCall {
	method: string;
	url: string;
	body?: unknown;
}

export function stubTestServer(put?: PutCallback, model = modelFixture()) {
	const current = structuredClone(model) as FinancialModelDocument & {
		[key: string]: unknown;
	};
	const calls: TestCall[] = [];
	const modelQueue: Array<Error | FinancialModelResponse> = [];
	const statusQueue: Array<Error | { readOnly: boolean }> = [];
	const presetsQueue: Array<Error | { presets: unknown[] }> = [];
	let statusValue: { readOnly: boolean; lastSyncAt?: string } = {
		readOnly: false,
	};
	let revisionValue = '"sha256-test"';
	let modelHold: Promise<Response> | null = null;
	const writeOverrides: Array<{
		match: (method: string, path: string) => boolean;
		response: Error | Record<string, unknown>;
	}> = [];
	const writeHolds: Array<{
		match: (method: string, path: string) => boolean;
		promise: Promise<unknown>;
		resolve: (value: unknown) => void;
	}> = [];
	const viaPut = (
		row: unknown,
	):
		| { row: unknown; issues: unknown[]; persisted: boolean; revision: string }
		| Error => {
		if (!put)
			return { row, issues: [], persisted: true, revision: revisionValue };
		const response = put(structuredClone(current) as FinancialModelDocument);
		if (response instanceof Error) return response;
		const errors = (response.issues ?? []).filter(
			(issue) => issue.severity === "error",
		);
		return {
			row,
			issues: response.issues ?? [],
			persisted: errors.length === 0,
			revision: response.revision ?? revisionValue,
		};
	};
	const moveIn =
		<T extends { id?: string; instanceId?: string }>(rows: T[]) =>
		(id: string, beforeId: string | null) => {
			const key = (row: T) => row.id ?? row.instanceId ?? "";
			const kept = rows.filter((row) => key(row) !== id);
			const moved = rows.find((row) => key(row) === id);
			if (!moved) return;
			if (!beforeId) {
				kept.push(moved);
			} else {
				const at = kept.findIndex((row) => key(row) === beforeId);
				kept.splice(at < 0 ? kept.length : at, 0, moved);
			}
			rows.length = 0;
			rows.push(...kept);
		};
	const evalRows = (evaluationType: string) => {
		const tables = (
			current as unknown as {
				evaluations: Record<string, { instanceId: string }[]>;
			}
		).evaluations as unknown as Record<string, { instanceId: string }[]>;
		return tables[evaluationType] ?? [];
	};
	const fail = (error: Error): never => {
		throw error;
	};
	const fetcher = vi.fn(async (url: unknown, init?: RequestInit) => {
		const method = init?.method ?? "GET";
		const path = String(url);
		const body =
			init?.body === undefined ? undefined : JSON.parse(String(init.body));
		calls.push({ method, url: path, body });
		if (path === "/v1/financial-model" && method === "GET") {
			if (modelHold) {
				const held = modelHold;
				modelHold = null;
				return held;
			}
			const next = modelQueue.shift();
			if (next) {
				if (next instanceof Error) fail(next);
				return ok(next);
			}
			return ok({
				document: structuredClone(current),
				issues: [],
				revision: revisionValue,
			});
		}
		if (path === "/v1/status") {
			const next = statusQueue.shift();
			if (next) {
				if (next instanceof Error) fail(next);
				return ok(next);
			}
			return ok(statusValue);
		}
		if (path === "/v1/amount-presets" && method === "GET") {
			const next = presetsQueue.shift();
			if (next) {
				if (next instanceof Error) fail(next);
				return ok(next);
			}
			return ok({ presets: [] });
		}
		if (path === "/v1/amount-presets" && method === "POST")
			return ok({
				row: {
					...(body as Record<string, unknown>),
					id: (body as { id?: string }).id || "preset-1",
				},
				issues: [],
				persisted: true,
			});
		if (path === "/v1/amount-presets/reorder" && method === "POST")
			return ok({ movedId: (body as { id: string }).id });
		const presetMatch = path.match(/^\/v1\/amount-presets\/([^/]+)$/);
		if (presetMatch) {
			if (method === "DELETE")
				return ok({ deletedId: decodeURIComponent(presetMatch[1]!) });
			return ok({ row: body, issues: [], persisted: true });
		}
		const override = writeOverrides.find((entry) => entry.match(method, path));
		if (override) {
			writeOverrides.splice(writeOverrides.indexOf(override), 1);
			if (override.response instanceof Error) fail(override.response);
			return ok(override.response);
		}
		const hold = writeHolds.find((entry) => entry.match(method, path));
		if (hold) {
			writeHolds.splice(writeHolds.indexOf(hold), 1);
			await hold.promise;
		}
		const write = (apply: () => void, row: unknown) => {
			const snapshot = structuredClone(current);
			apply();
			const outcome = viaPut(row);
			if (outcome instanceof Error) {
				Object.assign(current, snapshot);
				fail(outcome);
			}
			return ok({ ...outcome });
		};
		if (path === "/v1/accounts" && method === "POST")
			return write(() => {
				(current.accounts as unknown[]).push(structuredClone(body));
			}, body);
		let match = path.match(/^\/v1\/accounts\/([^/]+)$/);
		if (match) {
			const [, id] = match;
			if (method === "PATCH")
				return write(() => {
					current.accounts = (current.accounts as unknown[]).map((item) =>
						(item as { id: string }).id === id ? structuredClone(body) : item,
					) as typeof current.accounts;
				}, body);
			current.accounts = (current.accounts as unknown[]).filter(
				(item) => (item as { id: string }).id !== id,
			) as typeof current.accounts;
			return write(() => {}, undefined);
		}
		if (path === "/v1/accounts/reorder" && method === "POST")
			return write(() => {
				moveIn(current.accounts as { id?: string; instanceId?: string }[])(
					(body as { id: string }).id,
					(body as { beforeId: string | null }).beforeId ?? null,
				);
			}, undefined);
		if (path === "/v1/postings" && method === "POST")
			return write(() => {
				(current.postings as unknown[]).push(structuredClone(body));
			}, body);
		match = path.match(/^\/v1\/postings\/([^/]+)$/);
		if (match) {
			const [, id] = match;
			if (method === "PATCH")
				return write(() => {
					current.postings = (current.postings as unknown[]).map((item) =>
						(item as { id: string }).id === id ? structuredClone(body) : item,
					) as typeof current.postings;
				}, body);
			current.postings = (current.postings as unknown[]).filter(
				(item) => (item as { id: string }).id !== id,
			) as typeof current.postings;
			return write(() => {}, undefined);
		}
		if (path === "/v1/postings/reorder" && method === "POST")
			return write(() => {
				moveIn(current.postings as { id?: string; instanceId?: string }[])(
					(body as { id: string }).id,
					(body as { beforeId: string | null }).beforeId ?? null,
				);
			}, undefined);
		if (path === "/v1/recurrence-rules" && method === "POST")
			return write(() => {
				(current.recurrenceRules as unknown[]).push(structuredClone(body));
			}, body);
		match = path.match(/^\/v1\/recurrence-rules\/([^/]+)$/);
		if (match) {
			const [, id] = match;
			if (method === "PATCH")
				return write(() => {
					current.recurrenceRules = (current.recurrenceRules as unknown[]).map(
						(item) =>
							(item as { id: string }).id === id ? structuredClone(body) : item,
					) as typeof current.recurrenceRules;
				}, body);
			current.recurrenceRules = (current.recurrenceRules as unknown[]).filter(
				(item) => (item as { id: string }).id !== id,
			) as typeof current.recurrenceRules;
			return write(() => {}, undefined);
		}
		if (path === "/v1/recurrence-rules/reorder" && method === "POST")
			return write(() => {
				moveIn(
					current.recurrenceRules as { id?: string; instanceId?: string }[],
				)(
					(body as { id: string }).id,
					(body as { beforeId: string | null }).beforeId ?? null,
				);
			}, undefined);
		if (path === "/v1/checkpoints" && method === "POST") {
			const checkpoint = structuredClone(body);
			const same = (item: unknown) => {
				const row = item as Record<string, unknown>;
				const next = checkpoint as unknown as Record<string, unknown>;
				return row.AccountId === next.AccountId && row.Date === next.Date;
			};
			return write(() => {
				current.checkpoints = [
					...(current.checkpoints as unknown[]).filter((item) => !same(item)),
					checkpoint,
				] as typeof current.checkpoints;
			}, body);
		}
		if (path.startsWith("/v1/checkpoints?") && method === "DELETE") {
			const query = new URL(path, "http://localhost").searchParams;
			const accountId = query.get("accountId") ?? "";
			const date = query.get("date") ?? "";
			return write(() => {
				current.checkpoints = (current.checkpoints as unknown[]).filter(
					(item) =>
						!(
							(item as unknown as Record<string, unknown>).AccountId ===
								accountId &&
							(item as unknown as Record<string, unknown>).Date === date
						),
				) as typeof current.checkpoints;
			}, undefined);
		}
		const { type: evaluationType, ...evaluationRow } = (body ?? {}) as {
			type?: string;
			[key: string]: unknown;
		};
		if (path === "/v1/evaluations" && method === "POST")
			return write(() => {
				if (typeof evaluationType === "string")
					evalRows(evaluationType).push(
						structuredClone(evaluationRow) as { instanceId: string },
					);
			}, evaluationRow);
		match = path.match(/^\/v1\/evaluations\/([^/]+)$/);
		if (match && method === "PATCH") {
			const [, instanceId] = match;
			return write(() => {
				if (typeof evaluationType === "string") {
					const rows = evalRows(evaluationType);
					const at = rows.findIndex((item) => item.instanceId === instanceId);
					if (at >= 0)
						rows[at] = structuredClone(evaluationRow) as { instanceId: string };
				}
			}, evaluationRow);
		}
		if (match) {
			const [, instanceId] = match;
			return write(() => {
				for (const table of Object.values(
					(
						current as unknown as {
							evaluations: Record<string, { instanceId: string }[]>;
						}
					).evaluations as unknown as Record<string, { instanceId: string }[]>,
				)) {
					const at = table.findIndex((item) => item.instanceId === instanceId);
					if (at >= 0) table.splice(at, 1);
				}
			}, undefined);
		}
		if (path === "/v1/evaluations/reorder" && method === "POST")
			return write(() => {
				if (typeof evaluationType === "string")
					moveIn(evalRows(evaluationType))(
						(body as { instanceId: string }).instanceId,
						(body as { beforeId: string | null }).beforeId ?? null,
					);
			}, undefined);
		throw new Error(`Unexpected test API call: ${method} ${path}`);
	});
	vi.stubGlobal("fetch", fetcher);
	const modelFetches = () =>
		calls.filter((call) => call.url.endsWith("/v1/financial-model"));
	return {
		ok,
		calls,
		fetcher,
		model: current as FinancialModelDocument,
		modelFetches,
		failModelOnce: (error: Error | FinancialModelResponse) => {
			modelQueue.push(error);
		},
		failStatusOnce: (error: Error | { readOnly: boolean }) => {
			statusQueue.push(error);
		},
		failPresetsOnce: (error: Error | { presets: unknown[] }) => {
			presetsQueue.push(error);
		},
		setStatus: (status: { readOnly: boolean; lastSyncAt?: string }) => {
			statusValue = status;
		},
		setRevision: (revision: string) => {
			revisionValue = revision;
		},
		setDocument: (document: FinancialModelDocument | null) => {
			(current as { document?: unknown }).document = document;
			if (document === null) {
				// Serve a null document until replaced; keep tables for writes.
				(modelQueue as Array<Error | FinancialModelResponse>).unshift({
					document: null,
					issues: [],
					revision: revisionValue,
				} as unknown as FinancialModelResponse);
			}
		},
		holdModel: (pending: Promise<Response>) => {
			modelHold = pending;
		},
		holdNextWrite: (
			match: (method: string, path: string) => boolean,
			promise: Promise<unknown>,
		) => {
			let resolve!: (value: unknown) => void;
			const gate = new Promise<unknown>((inner) => {
				resolve = inner;
			});
			const entry = { match, promise: gate, resolve };
			writeHolds.push(entry);
			void promise.then(
				(value) => resolve(value),
				(value) => resolve(value),
			);
			return entry;
		},
		writeOnce: (
			match: (method: string, path: string) => boolean,
			response: Error | Record<string, unknown>,
		) => {
			writeOverrides.push({ match, response });
		},
		holdWriteOnce: (match: (method: string, path: string) => boolean) => {
			let resolve!: (value: unknown) => void;
			const gate = new Promise<unknown>((inner) => {
				resolve = inner;
			});
			const entry = { match, promise: gate, resolve };
			writeHolds.push(entry);
			return resolve;
		},
	};
}
