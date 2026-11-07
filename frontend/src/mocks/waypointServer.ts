import { vi } from "vitest";
import type {
	FinancialModel,
	FinancialModelResponse,
	ServerStatus,
} from "../api/index.ts";
import { ok } from "./fetch.ts";

// Single home for the workspace fetch fake. Migration left a copy of this
// server inside remoteHooks.test.ts and smaller variants in other test
// files; extend this module instead of adding another local stub.

export function modelFixture(): FinancialModel {
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
			transactionFulfillment: [],
		},
		transactions: [],
		schedules: [
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
	model: FinancialModel,
) => Error | FinancialModelResponse;

export interface TestCall {
	method: string;
	url: string;
	body?: unknown;
}

export function stubTestServer(put?: PutCallback, model = modelFixture()) {
	const current = structuredClone(model) as FinancialModel & {
		[key: string]: unknown;
	};
	const calls: TestCall[] = [];
	const modelQueue: Array<Error | FinancialModelResponse> = [];
	const statusQueue: Array<Error | ServerStatus> = [];
	const presetsQueue: Array<Error | { presets: unknown[] }> = [];
	let statusValue: ServerStatus = {
		readOnly: false,
		hasModel: true,
		syncConfigured: true,
		syncQuotaUsed: 0,
		syncQuotaLimit: 24,
	};
	let revisionValue = '"sha256-test"';
	const settleCandidates = new Map<string, unknown[]>();
	let modelHold: Promise<Response> | null = null;
	let statusHold: Promise<Response> | null = null;
	let purchasesHold: Promise<Response> | null = null;
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
		| { value: unknown; issues: unknown[]; saved: boolean; revision: string }
		| Error => {
		if (!put)
			return { value: row, issues: [], saved: true, revision: revisionValue };
		const response = put(structuredClone(current) as FinancialModel);
		if (response instanceof Error) return response;
		const errors = (response.issues ?? []).filter(
			(issue) => issue.severity === "error",
		);
		return {
			value: row,
			issues: response.issues ?? [],
			saved: errors.length === 0,
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
		model: FinancialModel & { [key: string]: unknown },
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
				model: structuredClone(current),
				issues: [],
				revision: revisionValue,
			});
		}
		if (path === "/v1/status") {
			if (statusHold) {
				const held = statusHold;
				statusHold = null;
				return held;
			}
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
		const settleRoute = route?.match(
			/^\/v1\/transactions\/([^/]+)\/settle-candidates$/,
		);
		if (settleRoute && method === "GET") {
			const transactionId = settleRoute[1]!;
			return ok({
				transactionId,
				candidates: settleCandidates.get(transactionId) ?? [],
				revision: revisionValue,
			});
		}
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
				// With fixture data the adjusted balance equals the latest observation.
				const balance = latest ? (latest.Balance as number) : 0;
				const syncOwned = checkpoints.some(
					(row) =>
						row.AccountId === account.id &&
						typeof row.source === "string" &&
						row.source !== "" &&
						row.source !== "user",
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
			const touches = (source: unknown, destinations: unknown) => {
				if (!accountId) return true;
				if (source === accountId) return true;
				return Array.isArray(destinations) && destinations.includes(accountId);
			};
			const transactions: unknown[] = [];
			for (const transaction of current.transactions as unknown as Record<
				string,
				unknown
			>[]) {
				if (!touches(transaction.sourceAccountId, transaction.destinations))
					continue;
				const syncOwned =
					typeof transaction.source === "string" &&
					transaction.source !== "" &&
					transaction.source !== "user";
				transactions.push({
					...transaction,
					syncOwned,
					// Bank rows are owner-editable including pending and
					// void.
					readOnly: false,
				});
			}
			return ok({ transactions, revision: narrowRevision });
		}
		if (route === "/v1/schedules" && method === "GET") {
			const accountId = query.get("accountId") ?? "";
			const touches = (source: unknown, destinations: unknown) => {
				if (!accountId) return true;
				if (source === accountId) return true;
				return Array.isArray(destinations) && destinations.includes(accountId);
			};
			const schedules = (
				current.schedules as unknown as Record<string, unknown>[]
			).filter((rule) => touches(rule.sourceAccountId, rule.destinations));
			return ok({ schedules, revision: narrowRevision });
		}
		if (route === "/v1/transactions/catalog" && method === "GET") {
			const items = [
				...(current.schedules as unknown as Record<string, unknown>[]).map(
					(rule) => ({ id: rule.id, kind: "schedule", name: rule.name }),
				),
				...(current.transactions as unknown as Record<string, unknown>[]).map(
					(transaction) => ({
						id: transaction.id,
						kind: "transaction",
						name: transaction.name,
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
				value: {
					...(body as Record<string, unknown>),
					id: (body as { id?: string }).id || "preset-1",
				},
				issues: [],
				saved: true,
			});
		if (path === "/v1/amount-presets/reorder" && method === "POST")
			return ok({ movedId: (body as { id: string }).id });
		const presetMatch = path.match(/^\/v1\/amount-presets\/([^/]+)$/);
		if (presetMatch) {
			if (method === "DELETE")
				return ok({ deletedId: decodeURIComponent(presetMatch[1]!) });
			return ok({ value: body, issues: [], saved: true });
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
					`generated-${(globalThis.crypto.getRandomValues(new Uint32Array(1))[0]! / 4294967296).toString(36).slice(2, 10)}`,
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
		if (path === "/v1/transactions" && method === "POST")
			return write(() => {
				const row = structuredClone(body) as Record<string, unknown>;
				const time =
					typeof row.time === "string" && row.time ? row.time : "00:00:00";
				const clock = time.length === 5 ? `${time}:00` : time;
				const stamp = Math.floor(
					new Date(`${String(row.date)}T${clock}Z`).getTime() / 1000,
				);
				row.transactionTime = stamp;
				row.postedTime = Math.floor(
					new Date(
						`${String(row.postedDate ?? row.date)}T00:00:00Z`,
					).getTime() / 1000,
				);
				(current.transactions as unknown[]).push(row);
			}, body);
		if (path === "/v1/model/import" && method === "POST") {
			const document = structuredClone(
				(body as { model: FinancialModel }).model,
			);
			return write(() => {
				for (const key of Object.keys(current)) delete current[key];
				Object.assign(current, document);
				statusValue = { ...statusValue, hasModel: true };
			}, document);
		}
		const categoryMatch = path.match(
			/^\/v1\/transactions\/([^/]+)\/categorize$/,
		);
		if (categoryMatch && method === "POST") {
			const [, id] = categoryMatch;
			const category = (body as { category?: string | null }).category ?? null;
			current.transactions = (current.transactions as unknown[]).map((item) => {
				const row = item as Record<string, unknown>;
				if (row.id !== id) return item;
				const { category: _category, categorySource: _source, ...rest } = row;
				return category ? { ...rest, category, categorySource: "user" } : rest;
			}) as typeof current.transactions;
			return ok({
				transactionId: id,
				...(category ? { category, categorySource: "user" } : {}),
			});
		}
		match = path.match(/^\/v1\/transactions\/([^/]+)$/);
		if (match && method === "DELETE") {
			const [, id] = match;
			return write(() => {
				current.transactions = (current.transactions as unknown[]).filter(
					(item) => (item as { id: string }).id !== id,
				) as typeof current.transactions;
			}, undefined);
		}
		const claimMatch = path.match(
			/^\/v1\/transactions\/([^/]+)\/(claim|release)$/,
		);
		if (claimMatch && method === "POST") {
			const [, id, action] = claimMatch;
			return write(() => {
				current.transactions = (current.transactions as unknown[]).map(
					(item) => {
						const row = item as Record<string, unknown>;
						if (row.id !== id) return item;
						if (action === "release") {
							const { claim: _claim, ...rest } = row;
							return rest;
						}
						return {
							...row,
							claim: {
								scheduleId: (body as { scheduleId: string }).scheduleId,
								occurrenceDate: (body as { occurrenceDate: string })
									.occurrenceDate,
							},
						};
					},
				) as typeof current.transactions;
			}, body);
		}
		const amendTransactionMatch = path.match(
			/^\/v1\/transactions\/([^/]+)\/amend$/,
		);
		if (amendTransactionMatch && method === "POST") {
			const [, id] = amendTransactionMatch;
			return write(() => {
				current.transactions = (current.transactions as unknown[]).map(
					(item) => {
						const row = item as Record<string, unknown>;
						if (row.id !== id) return item;
						return {
							...row,
							...(structuredClone(body) as Record<string, unknown>),
						};
					},
				) as typeof current.transactions;
			}, body);
		}
		const moveTransactionMatch = path.match(
			/^\/v1\/transactions\/([^/]+)\/move$/,
		);
		if (moveTransactionMatch && method === "POST") {
			const [, id] = moveTransactionMatch;
			return write(() => {
				moveIn(current.transactions as { id?: string; instanceId?: string }[])(
					id!,
					(body as { beforeId: string | null }).beforeId ?? null,
				);
			}, undefined);
		}
		const startMatch = path.match(/^\/v1\/transactions\/([^/]+)\/schedule$/);
		if (startMatch && method === "POST") {
			const [, id] = startMatch;
			const source = (current.transactions as unknown[]).find(
				(item) => (item as { id: string }).id === id,
			) as Record<string, unknown> | undefined;
			const payload = structuredClone(body) as Record<string, unknown>;
			return write(() => {
				const schedule = {
					id: (payload.id as string) || `schedule-${id}`,
					name: payload.name ?? source?.name,
					sourceAccountId:
						payload.sourceAccountId ?? source?.sourceAccountId ?? null,
					destinations: payload.destinations ?? source?.destinations ?? null,
					amount: payload.amount ?? source?.amount,
					frequency: payload.frequency,
					startDate: payload.startDate,
					endDate: payload.endDate ?? null,
					annualCap: null,
					priority: (current.schedules as unknown[]).length,
					enabled: payload.enabled ?? source?.enabled ?? true,
				};
				(current.schedules as unknown[]).push(schedule);
				current.transactions = (current.transactions as unknown[]).map(
					(item) => {
						const row = item as Record<string, unknown>;
						if (row.id !== id) return item;
						return {
							...row,
							claim: {
								scheduleId: schedule.id,
								occurrenceDate: schedule.startDate,
							},
						};
					},
				) as typeof current.transactions;
			}, body);
		}
		if (path === "/v1/planned-purchases" && method === "GET") {
			if (purchasesHold) {
				const held = purchasesHold;
				purchasesHold = null;
				return held;
			}
			return ok({
				plannedPurchases: structuredClone(current.plannedPurchases ?? []),
				revision: revisionValue,
			});
		}
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
		if (path === "/v1/schedules" && method === "POST")
			return write(() => {
				const rules = current.schedules as unknown as Record<string, unknown>[];
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
		match = path.match(/^\/v1\/schedules\/([^/]+)$/);
		if (match && method === "DELETE") {
			const [, id] = match;
			return write(() => {
				current.schedules = (current.schedules as unknown[]).filter(
					(item) => (item as { id: string }).id !== id,
				) as typeof current.schedules;
			}, undefined);
		}
		const amendScheduleMatch = path.match(/^\/v1\/schedules\/([^/]+)\/amend$/);
		if (amendScheduleMatch && method === "POST") {
			const [, id] = amendScheduleMatch;
			return write(() => {
				current.schedules = (current.schedules as unknown[]).map((item) =>
					(item as { id: string }).id === id
						? { ...(item as object), ...(structuredClone(body) as object), id }
						: item,
				) as typeof current.schedules;
			}, body);
		}
		const rescheduleMatch = path.match(
			/^\/v1\/schedules\/([^/]+)\/reschedule$/,
		);
		if (rescheduleMatch && method === "POST") {
			const [, id] = rescheduleMatch;
			return write(() => {
				current.schedules = (current.schedules as unknown[]).map((item) =>
					(item as { id: string }).id === id
						? { ...(item as object), ...(structuredClone(body) as object), id }
						: item,
				) as typeof current.schedules;
			}, body);
		}
		const moveScheduleMatch = path.match(/^\/v1\/schedules\/([^/]+)\/move$/);
		if (moveScheduleMatch && method === "POST") {
			const [, id] = moveScheduleMatch;
			return write(() => {
				moveIn(current.schedules as { id?: string; instanceId?: string }[])(
					id!,
					(body as { beforeId: string | null }).beforeId ?? null,
				);
			}, undefined);
		}
		const endMatch = path.match(
			/^\/v1\/schedules\/([^/]+)\/end-with-transaction$/,
		);
		if (endMatch && method === "POST") {
			const [, id] = endMatch;
			const schedule = (current.schedules as unknown[]).find(
				(item) => (item as { id: string }).id === id,
			) as Record<string, unknown> | undefined;
			const payload = structuredClone(body) as Record<string, unknown>;
			return write(() => {
				current.schedules = (current.schedules as unknown[]).filter(
					(item) => (item as { id: string }).id !== id,
				) as typeof current.schedules;
				const time =
					typeof payload.time === "string" && payload.time
						? payload.time
						: "00:00:00";
				const clock = time.length === 5 ? `${time}:00` : time;
				const stamp = Math.floor(
					new Date(`${String(payload.date)}T${clock}Z`).getTime() / 1000,
				);
				const transaction = {
					id: (payload.id as string) || `transaction-${id}`,
					name: schedule?.name,
					sourceAccountId:
						payload.sourceAccountId ?? schedule?.sourceAccountId ?? null,
					destinations: payload.destinations ?? schedule?.destinations ?? null,
					amount: payload.amount ?? schedule?.amount,
					postedTime: Math.floor(
						new Date(
							`${String(payload.postedDate ?? payload.date)}T00:00:00Z`,
						).getTime() / 1000,
					),
					transactionTime: stamp,
					enabled: payload.enabled ?? schedule?.enabled ?? true,
				};
				(current.transactions as unknown[]).push(transaction);
			}, undefined);
		}
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
	const statusFetches = () =>
		calls.filter((call) => call.url.endsWith("/v1/status"));
	return {
		ok,
		calls,
		fetcher,
		model: current as FinancialModel,
		modelFetches,
		statusFetches,
		failModelOnce: (error: Error | FinancialModelResponse) => {
			modelQueue.push(error);
		},
		failStatusOnce: (error: Error | ServerStatus) => {
			statusQueue.push(error);
		},
		failPresetsOnce: (error: Error | { presets: unknown[] }) => {
			presetsQueue.push(error);
		},
		setStatus: (status: ServerStatus) => {
			statusValue = status;
		},
		setRevision: (revision: string) => {
			revisionValue = revision;
		},
		setSettleCandidates: (transactionId: string, candidates: unknown[]) => {
			settleCandidates.set(transactionId, candidates);
		},
		setModel: (model: FinancialModel | null) => {
			(current as { model?: unknown }).model = model;
			statusValue = { ...statusValue, hasModel: model !== null };
			if (model === null) {
				// Serve a null model until replaced; keep tables for writes.
				(modelQueue as Array<Error | FinancialModelResponse>).unshift({
					model: null,
					issues: [],
					revision: revisionValue,
				} as unknown as FinancialModelResponse);
			}
		},
		holdModel: (pending: Promise<Response>) => {
			modelHold = pending;
		},
		holdStatus: (pending: Promise<Response>) => {
			statusHold = pending;
		},
		holdPurchases: (pending: Promise<Response>) => {
			purchasesHold = pending;
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
