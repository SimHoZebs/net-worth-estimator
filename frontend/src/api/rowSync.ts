import type { ApiRequestOptions } from "./client.ts";
import type {
	BackendAccount,
	BackendCheckpoint,
	BackendPosting,
	BackendRecurrenceRule,
	EvaluationInstance,
	FinancialModelDocument,
	ModelValidationIssue,
	RowDeleteResponse,
	RowWriteResponse,
} from "./contracts.ts";

// RowWriter is the row-operation surface a document save needs. ApiClient
// implements it; tests substitute fakes.
export interface RowWriter {
	createAccount(
		account: BackendAccount,
		options?: ApiRequestOptions,
	): Promise<Error | RowWriteResponse<BackendAccount>>;
	updateAccount(
		id: string,
		account: BackendAccount,
		options?: ApiRequestOptions,
	): Promise<Error | RowWriteResponse<BackendAccount>>;
	deleteAccount(
		id: string,
		options?: ApiRequestOptions,
	): Promise<Error | RowDeleteResponse>;
	moveAccount(
		id: string,
		beforeId: string | null,
		options?: ApiRequestOptions,
	): Promise<Error | RowDeleteResponse>;
	createPosting(
		posting: BackendPosting,
		options?: ApiRequestOptions,
	): Promise<Error | RowWriteResponse<BackendPosting>>;
	updatePosting(
		id: string,
		posting: BackendPosting,
		options?: ApiRequestOptions,
	): Promise<Error | RowWriteResponse<BackendPosting>>;
	deletePosting(
		id: string,
		options?: ApiRequestOptions,
	): Promise<Error | RowDeleteResponse>;
	movePosting(
		id: string,
		beforeId: string | null,
		options?: ApiRequestOptions,
	): Promise<Error | RowDeleteResponse>;
	createRule(
		rule: BackendRecurrenceRule,
		options?: ApiRequestOptions,
	): Promise<Error | RowWriteResponse<BackendRecurrenceRule>>;
	updateRule(
		id: string,
		rule: BackendRecurrenceRule,
		options?: ApiRequestOptions,
	): Promise<Error | RowWriteResponse<BackendRecurrenceRule>>;
	deleteRule(
		id: string,
		options?: ApiRequestOptions,
	): Promise<Error | RowDeleteResponse>;
	moveRule(
		id: string,
		beforeId: string | null,
		options?: ApiRequestOptions,
	): Promise<Error | RowDeleteResponse>;
	saveCheckpoint(
		checkpoint: BackendCheckpoint,
		options?: ApiRequestOptions,
	): Promise<Error | RowWriteResponse<BackendCheckpoint>>;
	deleteCheckpoint(
		accountId: string,
		date: string,
		options?: ApiRequestOptions,
	): Promise<Error | RowDeleteResponse>;
	createEvaluation(
		item: EvaluationInstance,
		evaluationType: string,
		options?: ApiRequestOptions,
	): Promise<Error | RowWriteResponse<EvaluationInstance>>;
	updateEvaluation(
		instanceId: string,
		item: EvaluationInstance,
		evaluationType: string,
		options?: ApiRequestOptions,
	): Promise<Error | RowWriteResponse<EvaluationInstance>>;
	deleteEvaluation(
		instanceId: string,
		options?: ApiRequestOptions,
	): Promise<Error | RowDeleteResponse>;
	moveEvaluation(
		evaluationType: string,
		instanceId: string,
		beforeId: string | null,
		options?: ApiRequestOptions,
	): Promise<Error | RowDeleteResponse>;
}

export type RowOperation =
	| { kind: "account"; action: "create"; row: BackendAccount }
	| { kind: "account"; action: "update"; id: string; row: BackendAccount }
	| { kind: "account"; action: "delete"; id: string }
	| { kind: "account"; action: "move"; id: string; beforeId: string | null }
	| { kind: "posting"; action: "create"; row: BackendPosting }
	| { kind: "posting"; action: "update"; id: string; row: BackendPosting }
	| { kind: "posting"; action: "delete"; id: string }
	| { kind: "posting"; action: "move"; id: string; beforeId: string | null }
	| { kind: "rule"; action: "create"; row: BackendRecurrenceRule }
	| { kind: "rule"; action: "update"; id: string; row: BackendRecurrenceRule }
	| { kind: "rule"; action: "delete"; id: string }
	| { kind: "rule"; action: "move"; id: string; beforeId: string | null }
	| { kind: "checkpoint"; action: "save"; row: BackendCheckpoint }
	| { kind: "checkpoint"; action: "delete"; accountId: string; date: string }
	| {
			kind: "evaluation";
			action: "create";
			evaluationType: string;
			row: EvaluationInstance;
	  }
	| {
			kind: "evaluation";
			action: "update";
			evaluationType: string;
			instanceId: string;
			row: EvaluationInstance;
	  }
	| { kind: "evaluation"; action: "delete"; instanceId: string }
	| {
			kind: "evaluation";
			action: "move";
			evaluationType: string;
			instanceId: string;
			beforeId: string | null;
	  };

function stableStringify(value: unknown): string {
	return JSON.stringify(value);
}

function diffOrdered<T>(
	base: T[],
	next: T[],
	getID: (row: T) => string,
	equal: (a: T, b: T) => boolean,
	create: (row: T) => RowOperation,
	update: (id: string, row: T) => RowOperation,
	remove: (id: string) => RowOperation,
	move: (id: string, beforeId: string | null) => RowOperation,
): RowOperation[] {
	const operations: RowOperation[] = [];
	const baseByID = new Map(base.map((row) => [getID(row), row]));
	const nextByID = new Map(next.map((row) => [getID(row), row]));
	for (const row of next) {
		const id = getID(row);
		const previous = baseByID.get(id);
		if (!previous) operations.push(create(row));
		else if (!equal(previous, row)) operations.push(update(id, row));
	}
	for (const row of base) {
		if (!nextByID.has(getID(row))) operations.push(remove(getID(row)));
	}
	const baseOrder = base.map(getID);
	const nextOrder = next.map(getID);
	if (stableStringify(baseOrder) !== stableStringify(nextOrder)) {
		for (let index = 0; index < nextOrder.length; index += 1) {
			const id = nextOrder[index];
			if (id === undefined || !baseByID.has(id)) continue;
			const beforeId = nextOrder[index + 1] ?? null;
			operations.push(move(id, beforeId));
		}
	}
	return operations;
}

export function diffFinancialModelDocuments(
	base: FinancialModelDocument | null,
	next: FinancialModelDocument,
): RowOperation[] {
	const empty: FinancialModelDocument = {
		sourcePath: "",
		accounts: [],
		checkpoints: [],
		evaluations: {
			financialIndependence: [],
			netWorthThreshold: [],
			accountBalance: [],
			postingFulfillment: [],
			cycleFulfillment: [],
		},
		postings: [],
		recurrenceRules: [],
	};
	const from = base ?? empty;
	const operations: RowOperation[] = [];
	const same = (a: unknown, b: unknown) =>
		stableStringify(a) === stableStringify(b);

	operations.push(
		...diffOrdered(
			from.accounts,
			next.accounts,
			(row) => row.id,
			same,
			(row) => ({ kind: "account", action: "create", row }),
			(id, row) => ({ kind: "account", action: "update", id, row }),
			(id) => ({ kind: "account", action: "delete", id }),
			(id, beforeId) => ({ kind: "account", action: "move", id, beforeId }),
		),
	);
	operations.push(
		...diffOrdered(
			from.postings,
			next.postings,
			(row) => row.id,
			same,
			(row) => ({ kind: "posting", action: "create", row }),
			(id, row) => ({ kind: "posting", action: "update", id, row }),
			(id) => ({ kind: "posting", action: "delete", id }),
			(id, beforeId) => ({ kind: "posting", action: "move", id, beforeId }),
		),
	);
	operations.push(
		...diffOrdered(
			from.recurrenceRules,
			next.recurrenceRules,
			(row) => row.id,
			same,
			(row) => ({ kind: "rule", action: "create", row }),
			(id, row) => ({ kind: "rule", action: "update", id, row }),
			(id) => ({ kind: "rule", action: "delete", id }),
			(id, beforeId) => ({ kind: "rule", action: "move", id, beforeId }),
		),
	);

	const checkpointKey = (row: BackendCheckpoint) =>
		`${row.AccountId}\x00${row.Date}`;
	const baseCheckpoints = new Map(
		from.checkpoints.map((row) => [checkpointKey(row), row]),
	);
	for (const row of next.checkpoints) {
		const previous = baseCheckpoints.get(checkpointKey(row));
		if (!previous || !same(previous, row))
			operations.push({ kind: "checkpoint", action: "save", row });
	}
	for (const row of from.checkpoints) {
		if (
			!next.checkpoints.some(
				(item) => checkpointKey(item) === checkpointKey(row),
			)
		)
			operations.push({
				kind: "checkpoint",
				action: "delete",
				accountId: row.AccountId,
				date: row.Date,
			});
	}

	const evalTables = (
		document: FinancialModelDocument,
	): { type: string; rows: EvaluationInstance[] }[] => [
		{
			type: "financialIndependence",
			rows: document.evaluations.financialIndependence,
		},
		{ type: "netWorthThreshold", rows: document.evaluations.netWorthThreshold },
		{ type: "accountBalance", rows: document.evaluations.accountBalance },
		{
			type: "postingFulfillment",
			rows: document.evaluations.postingFulfillment,
		},
		{
			type: "cycleFulfillment",
			rows: document.evaluations.cycleFulfillment ?? [],
		},
	];
	const baseEvalByID = new Map<
		string,
		{ type: string; row: EvaluationInstance }
	>();
	for (const table of evalTables(from)) {
		for (const row of table.rows)
			baseEvalByID.set(row.instanceId, { type: table.type, row });
	}
	const nextEvalByID = new Map<
		string,
		{ type: string; row: EvaluationInstance }
	>();
	for (const table of evalTables(next)) {
		for (const row of table.rows)
			nextEvalByID.set(row.instanceId, { type: table.type, row });
	}
	for (const [instanceId, entry] of nextEvalByID) {
		const previous = baseEvalByID.get(instanceId);
		if (!previous)
			operations.push({
				kind: "evaluation",
				action: "create",
				evaluationType: entry.type,
				row: entry.row,
			});
		else if (!same(previous.row, entry.row) || previous.type !== entry.type)
			operations.push({
				kind: "evaluation",
				action: "update",
				evaluationType: entry.type,
				instanceId,
				row: entry.row,
			});
	}
	for (const [instanceId] of baseEvalByID) {
		if (!nextEvalByID.has(instanceId))
			operations.push({ kind: "evaluation", action: "delete", instanceId });
	}
	for (const table of evalTables(next)) {
		const baseOrder = (
			evalTables(from).find((item) => item.type === table.type)?.rows ?? []
		).map((row) => row.instanceId);
		const nextOrder = table.rows.map((row) => row.instanceId);
		if (stableStringify(baseOrder) === stableStringify(nextOrder)) continue;
		for (let index = 0; index < nextOrder.length; index += 1) {
			const instanceId = nextOrder[index];
			if (instanceId === undefined || !baseEvalByID.has(instanceId)) continue;
			operations.push({
				kind: "evaluation",
				action: "move",
				evaluationType: table.type,
				instanceId,
				beforeId: nextOrder[index + 1] ?? null,
			});
		}
	}
	return operations;
}

export type RowApplyResult =
	| { ok: true; issues: ModelValidationIssue[] }
	| { ok: false; issues: ModelValidationIssue[] }
	| Error;

async function collectIssues(
	response: Error | { issues: ModelValidationIssue[]; persisted: boolean },
	issues: ModelValidationIssue[],
): Promise<Error | ModelValidationIssue[] | null> {
	if (response instanceof Error) return response;
	issues.push(...response.issues);
	if (!response.persisted) return issues;
	return null;
}

export async function applyRowOperations(
	client: RowWriter,
	operations: RowOperation[],
	options: ApiRequestOptions = {},
): Promise<RowApplyResult> {
	const issues: ModelValidationIssue[] = [];
	for (const operation of operations) {
		if (options.signal?.aborted)
			return issues.length ? { ok: false, issues } : { ok: true, issues };
		let outcome: Error | ModelValidationIssue[] | null;
		switch (operation.kind) {
			case "account":
				if (operation.action === "create")
					outcome = await collectIssues(
						await client.createAccount(operation.row, options),
						issues,
					);
				else if (operation.action === "update")
					outcome = await collectIssues(
						await client.updateAccount(operation.id, operation.row, options),
						issues,
					);
				else if (operation.action === "delete")
					outcome = await collectIssues(
						await client
							.deleteAccount(operation.id, options)
							.then((response) =>
								response instanceof Error
									? response
									: {
											issues: [],
											persisted: true,
											revision: response.revision,
										},
							),
						issues,
					);
				else
					outcome = await collectIssues(
						await client
							.moveAccount(operation.id, operation.beforeId, options)
							.then((response) =>
								response instanceof Error
									? response
									: {
											issues: [],
											persisted: true,
											revision: response.revision,
										},
							),
						issues,
					);
				break;
			case "posting":
				if (operation.action === "create")
					outcome = await collectIssues(
						await client.createPosting(operation.row, options),
						issues,
					);
				else if (operation.action === "update")
					outcome = await collectIssues(
						await client.updatePosting(operation.id, operation.row, options),
						issues,
					);
				else if (operation.action === "delete")
					outcome = await collectIssues(
						await client
							.deletePosting(operation.id, options)
							.then((response) =>
								response instanceof Error
									? response
									: {
											issues: [],
											persisted: true,
											revision: response.revision,
										},
							),
						issues,
					);
				else
					outcome = await collectIssues(
						await client
							.movePosting(operation.id, operation.beforeId, options)
							.then((response) =>
								response instanceof Error
									? response
									: {
											issues: [],
											persisted: true,
											revision: response.revision,
										},
							),
						issues,
					);
				break;
			case "rule":
				if (operation.action === "create")
					outcome = await collectIssues(
						await client.createRule(operation.row, options),
						issues,
					);
				else if (operation.action === "update")
					outcome = await collectIssues(
						await client.updateRule(operation.id, operation.row, options),
						issues,
					);
				else if (operation.action === "delete")
					outcome = await collectIssues(
						await client.deleteRule(operation.id, options).then((response) =>
							response instanceof Error
								? response
								: {
										issues: [],
										persisted: true,
										revision: response.revision,
									},
						),
						issues,
					);
				else
					outcome = await collectIssues(
						await client
							.moveRule(operation.id, operation.beforeId, options)
							.then((response) =>
								response instanceof Error
									? response
									: {
											issues: [],
											persisted: true,
											revision: response.revision,
										},
							),
						issues,
					);
				break;
			case "checkpoint":
				if (operation.action === "save")
					outcome = await collectIssues(
						await client.saveCheckpoint(operation.row, options),
						issues,
					);
				else
					outcome = await collectIssues(
						await client
							.deleteCheckpoint(operation.accountId, operation.date, options)
							.then((response) =>
								response instanceof Error
									? response
									: {
											issues: [],
											persisted: true,
											revision: response.revision,
										},
							),
						issues,
					);
				break;
			case "evaluation":
				if (operation.action === "create")
					outcome = await collectIssues(
						await client.createEvaluation(
							operation.row,
							operation.evaluationType,
							options,
						),
						issues,
					);
				else if (operation.action === "update")
					outcome = await collectIssues(
						await client.updateEvaluation(
							operation.instanceId,
							operation.row,
							operation.evaluationType,
							options,
						),
						issues,
					);
				else if (operation.action === "delete")
					outcome = await collectIssues(
						await client
							.deleteEvaluation(operation.instanceId, options)
							.then((response) =>
								response instanceof Error
									? response
									: {
											issues: [],
											persisted: true,
											revision: response.revision,
										},
							),
						issues,
					);
				else
					outcome = await collectIssues(
						await client
							.moveEvaluation(
								operation.evaluationType,
								operation.instanceId,
								operation.beforeId,
								options,
							)
							.then((response) =>
								response instanceof Error
									? response
									: {
											issues: [],
											persisted: true,
											revision: response.revision,
										},
							),
						issues,
					);
				break;
		}
		if (outcome instanceof Error) return outcome;
		if (outcome !== null) return { ok: false, issues: outcome };
	}
	return { ok: true, issues };
}
