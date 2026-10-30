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
			{ AccountId: "cash", Balance: 100, observedAt: 1769903999 },
			{ AccountId: "loan", Balance: -40, observedAt: 1769903999 },
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
	const upsertStubCheckpoint = (
		model: FinancialModelDocument & { [key: string]: unknown },
		balance: number | undefined,
		observedAt: number | undefined,
		accountId: string | undefined,
	) => {
		if (typeof balance !== "number" || !observedAt || !accountId) return;
		const rows = model.checkpoints as unknown as Record<string, unknown>[];
		const at = rows.findIndex(
			(row) => row.AccountId === accountId && row.observedAt === observedAt,
		);
		const checkpoint = {
			AccountId: accountId,
			Balance: balance,
			observedAt,
		};
		if (at >= 0) rows[at] = checkpoint;
		else rows.push(checkpoint);
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
		const [route, queryString] = String(path).split("?");
		const query = new URLSearchParams(queryString ?? "");
		const narrowRevision = revisionValue;
		if (route === "/v1/accounts/balances" && method === "GET") {
			const checkpoints = current.checkpoints as unknown as Record<
				string,
				unknown
			>[];
			let asOf = query.get("asOf") ?? "";
			if (!asOf) {
				let latest = 0;
				for (const row of checkpoints) {
					const instant = row.observedAt as number;
					if (instant > latest) latest = instant;
				}
				asOf = latest
					? new Date(latest * 1000).toISOString().slice(0, 10)
					: new Date().toISOString().slice(0, 10);
			}
			const accounts = (
				current.accounts as unknown as Record<string, unknown>[]
			).map((account) => {
				let latest: Record<string, unknown> | null = null;
				let latestInstant = -1;
				for (const row of checkpoints) {
					const day = new Date((row.observedAt as number) * 1000)
						.toISOString()
						.slice(0, 10);
					if (row.AccountId !== account.id || day > asOf) continue;
					const instant = row.observedAt as number;
					if (latest === null || instant >= latestInstant) {
						latest = row;
						latestInstant = instant;
					}
				}
				// The mock has no replay engine: with fixture data the
				// adjusted balance equals the latest observation, so the
				// row mirrors the server contract shape (adjusted balance
				// plus separate observation).
				const balance = latest ? (latest.Balance as number) : 0;
				const syncOwned = checkpoints.some(
					(row) =>
						row.AccountId === account.id &&
						typeof row.source === "string" &&
						row.source !== "" &&
						row.source !== "user" &&
						row.source !== "model",
				);
				return {
					...account,
					balance,
					observedOn: latest
						? new Date((latest.observedAt as number) * 1000)
								.toISOString()
								.slice(0, 10)
						: asOf,
					hasCheckpoint: latest !== null,
					archived:
						account.kind === "debt" &&
						latest !== null &&
						Math.abs(balance) < 0.005,
					syncOwned,
					readOnly: syncOwned,
					observedBalance: latest ? latest.Balance : null,
					observedAt: latest ? latestInstant : null,
				};
			});
			return ok({ accounts, asOf, revision: narrowRevision });
		}
		if (route === "/v1/transactions" && method === "GET") {
			const accountId = query.get("accountId") ?? "";
			const recurring = query.get("recurring") ?? "all";
			const touches = (source: unknown, destinations: unknown) => {
				if (!accountId) return true;
				if (source === accountId) return true;
				return Array.isArray(destinations) && destinations.includes(accountId);
			};
			const transactions: unknown[] = [];
			if (recurring !== "once") {
				for (const rule of current.recurrenceRules as unknown as Record<
					string,
					unknown
				>[]) {
					if (!touches(rule.sourceAccountId, rule.destinations)) continue;
					transactions.push({ ...rule, kind: "rule" });
				}
			}
			if (recurring !== "recurring") {
				for (const posting of current.postings as unknown as Record<
					string,
					unknown
				>[]) {
					if (!touches(posting.sourceAccountId, posting.destinations)) continue;
					const syncOwned =
						typeof posting.source === "string" &&
						posting.source !== "" &&
						posting.source !== "user" &&
						posting.source !== "model";
					transactions.push({
						...posting,
						kind: "posting",
						frequency: "once",
						syncOwned,
						readOnly: syncOwned,
					});
				}
			}
			return ok({ transactions, revision: narrowRevision });
		}
		if (route === "/v1/transactions/catalog" && method === "GET") {
			const items = [
				...(
					current.recurrenceRules as unknown as Record<string, unknown>[]
				).map((rule) => ({ id: rule.id, kind: "rule", name: rule.name })),
				...(current.postings as unknown as Record<string, unknown>[]).map(
					(posting) => ({
						id: posting.id,
						kind: "posting",
						name: posting.name,
					}),
				),
			];
			return ok({ items, revision: narrowRevision });
		}
		if (route === "/v1/evaluations/summary" && method === "GET") {
			return ok({
				evaluations: structuredClone(current.evaluations),
				revision: narrowRevision,
			});
		}
		if (route === "/v1/checkpoints" && method === "GET") {
			const accountId = query.get("accountId") ?? "";
			const since = query.get("since") ?? "";
			const until = query.get("until") ?? "";
			const checkpoints = (
				current.checkpoints as unknown as Record<string, unknown>[]
			).filter((row) => {
				if (accountId && row.AccountId !== accountId) return false;
				const day = new Date((row.observedAt as number) * 1000)
					.toISOString()
					.slice(0, 10);
				if (since && day < since) return false;
				if (until && day > until) return false;
				return true;
			});
			return ok({ checkpoints, revision: narrowRevision });
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
		if (path === "/v1/accounts" && method === "POST") {
			const row = {
				...structuredClone(body),
				id:
					(body as { id?: string }).id ||
					`generated-${Math.random().toString(36).slice(2, 10)}`,
			};
			return write(() => {
				(current.accounts as unknown[]).push(structuredClone(row));
				upsertStubCheckpoint(
					current,
					(body as { balance?: number; observedAt?: number }).balance,
					(body as { balance?: number; observedAt?: number }).observedAt,
					(row as { id: string }).id,
				);
			}, row);
		}
		let match = path.match(/^\/v1\/accounts\/([^/]+)$/);
		if (match) {
			const [, id] = match;
			if (method === "PATCH")
				return write(() => {
					current.accounts = (current.accounts as unknown[]).map((item) =>
						(item as { id: string }).id === id
							? { ...structuredClone(body), id }
							: item,
					) as typeof current.accounts;
					upsertStubCheckpoint(
						current,
						(body as { balance?: number; observedAt?: number }).balance,
						(body as { balance?: number; observedAt?: number }).observedAt,
						id,
					);
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
					const postings = current.postings as unknown[];
					const next = structuredClone(body) as Record<string, unknown>;
					current.postings = postings.map((item) =>
						(item as { id: string }).id === id ? { ...next, id } : item,
					) as typeof current.postings;
				}, body);
			current.postings = (current.postings as unknown[]).filter(
				(item) => (item as { id: string }).id !== id,
			) as typeof current.postings;
			return write(() => {}, undefined);
		}
		const convertMatch = path.match(/^\/v1\/transactions\/([^/]+)\/convert$/);
		if (convertMatch && method === "POST") {
			const [, id] = convertMatch;
			const kind = (body as { kind?: string }).kind;
			const payload = body as {
				posting?: Record<string, unknown>;
				rule?: Record<string, unknown>;
			};
			return write(() => {
				if (kind === "posting") {
					current.recurrenceRules = (
						current.recurrenceRules as unknown[]
					).filter(
						(item) => (item as { id: string }).id !== id,
					) as typeof current.recurrenceRules;
					(current.postings as unknown[]).push({
						...structuredClone(payload.posting),
						id,
					});
				} else if (kind === "rule") {
					current.postings = (current.postings as unknown[]).filter(
						(item) => (item as { id: string }).id !== id,
					) as typeof current.postings;
					(current.recurrenceRules as unknown[]).push({
						...structuredClone(payload.rule),
						id,
					});
				}
			}, undefined);
		}
		if (path === "/v1/postings/reorder" && method === "POST")
			return write(() => {
				moveIn(current.postings as { id?: string; instanceId?: string }[])(
					(body as { id: string }).id,
					(body as { beforeId: string | null }).beforeId ?? null,
				);
			}, undefined);
		if (path === "/v1/planned-purchases" && method === "POST")
			return write(() => {
				const rows = (current.plannedPurchases ??= []);
				const row = structuredClone(body) as NonNullable<
					typeof current.plannedPurchases
				>[number];
				if (row.priority === undefined)
					row.priority =
						rows.reduce((max, p) => Math.max(max, p.priority), -1) + 1;
				rows.push(row);
			}, body);
		if (path === "/v1/planned-purchases/reorder" && method === "POST")
			return write(() => {
				const rows = (current.plannedPurchases ??= []);
				moveIn(rows)(
					(body as { id: string }).id,
					(body as { beforeId?: string }).beforeId ?? null,
				);
				rows.forEach((row, priority) => {
					row.priority = priority;
				});
			}, undefined);
		match = path.match(/^\/v1\/planned-purchases\/([^/]+)$/);
		if (match) {
			const [, id] = match;
			return write(
				() => {
					const rows = current.plannedPurchases ?? [];
					current.plannedPurchases =
						method === "PATCH"
							? rows.map((row) =>
									row.id === id
										? { ...(structuredClone(body) as typeof row), id }
										: row,
								)
							: rows.filter((row) => row.id !== id);
				},
				method === "PATCH" ? body : undefined,
			);
		}
		if (path === "/v1/recurrence-rules" && method === "POST")
			return write(() => {
				const rules = current.recurrenceRules as unknown as Record<
					string,
					unknown
				>[];
				const next = structuredClone(body) as Record<string, unknown>;
				if (typeof next.priority !== "number") {
					let max = -1;
					for (const rule of rules) {
						if (typeof rule.priority === "number" && rule.priority > max)
							max = rule.priority as number;
					}
					next.priority = max + 1;
				}
				rules.push(next);
			}, body);
		match = path.match(/^\/v1\/recurrence-rules\/([^/]+)$/);
		if (match) {
			const [, id] = match;
			if (method === "PATCH")
				return write(() => {
					const rules = current.recurrenceRules as unknown[];
					const stored = rules.find(
						(item) => (item as { id: string }).id === id,
					) as Record<string, unknown> | undefined;
					const next = structuredClone(body) as Record<string, unknown>;
					// Omitted optionals keep their stored values.
					if (next.priority === undefined) next.priority = stored?.priority;
					if (next.annualCap === undefined) next.annualCap = stored?.annualCap;
					current.recurrenceRules = rules.map((item) =>
						(item as { id: string }).id === id ? { ...next, id } : item,
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
				return (
					row.AccountId === next.AccountId && row.observedAt === next.observedAt
				);
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
			const observedAt = Number(query.get("observedAt") ?? "");
			return write(() => {
				current.checkpoints = (current.checkpoints as unknown[]).filter(
					(item) =>
						!(
							(item as unknown as Record<string, unknown>).AccountId ===
								accountId &&
							(item as unknown as Record<string, unknown>).observedAt ===
								observedAt
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
					const tables = (
						current as unknown as {
							evaluations: Record<string, { instanceId: string }[]>;
						}
					).evaluations as unknown as Record<string, { instanceId: string }[]>;
					for (const table of Object.values(tables)) {
						const at = table.findIndex(
							(item) => item.instanceId === instanceId,
						);
						if (at >= 0) table.splice(at, 1);
					}
					evalRows(evaluationType).push(
						structuredClone(evaluationRow) as { instanceId: string },
					);
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
