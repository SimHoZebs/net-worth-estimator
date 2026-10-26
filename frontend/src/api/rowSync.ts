import type { ApiRequestOptions } from "@/api/http.ts";
import type {
	BackendAccount,
	BackendCheckpoint,
	BackendPosting,
	BackendRecurrenceRule,
	EvaluationInstance,
	FinancialModelDocument,
	ModelValidationIssue,
} from "@/api/contracts.ts";
import {
	createAccount,
	createEvaluation,
	createPosting,
	createRule,
	deleteAccount,
	deleteCheckpoint,
	deleteEvaluation,
	deletePosting,
	deleteRule,
	moveAccount,
	moveEvaluation,
	movePosting,
	moveRule,
	saveCheckpoint,
	updateAccount,
	updateEvaluation,
	updatePosting,
	updateRule,
} from "@/api/generated/endpoints.ts";
import type {
	AccountBody,
	Checkpoint,
	EvaluationUpdate,
	ModelValidationIssue as GeneratedIssue,
	PostingBody,
	RuleBody,
} from "@/api/generated/model/index.ts";
import { ApiRequestError } from "@/api/http.ts";
import { getResourceScope } from "@/auth/resourceScope.ts";
import { ResourceScopeError } from "@/api/scopedRequest.ts";

// Row operations run through generated endpoints. Wire payloads pass through
// untouched; only the envelope is normalized onto the domain shape.
function toIssue(issue: GeneratedIssue): ModelValidationIssue {
	return {
		severity: issue.severity,
		code: issue.code,
		message: issue.message,
		path: (issue.path ?? []) as ModelValidationIssue["path"],
	};
}

async function runWrite(
	issues: ModelValidationIssue[],
	task: () => Promise<{ status: number; data: unknown }>,
): Promise<Error | ModelValidationIssue[] | null> {
	let data: {
		issues?: GeneratedIssue[] | null;
		persisted?: boolean;
		revision: string;
	};
	try {
		data = (await task()).data as {
			issues?: GeneratedIssue[] | null;
			persisted?: boolean;
			revision: string;
		};
	} catch (cause) {
		return cause instanceof Error ? cause : new ApiRequestError(cause);
	}
	// The server can send null issues; callers below always expect an array.
	issues.push(...(data.issues ?? []).map(toIssue));
	if (data.persisted === false) return issues;
	return null;
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

export async function applyRowOperations(
	operations: RowOperation[],
	options: ApiRequestOptions = {},
): Promise<RowApplyResult> {
	const scope = getResourceScope();
	const issues: ModelValidationIssue[] = [];
	for (const operation of operations) {
		if (options.signal?.aborted)
			return issues.length ? { ok: false, issues } : { ok: true, issues };
		// A scope change retires the remaining writes instead of sending a
		// request computed for one plan against another plan's workspace.
		if (scope !== getResourceScope()) return new ResourceScopeError();
		let outcome: Error | ModelValidationIssue[] | null;
		switch (operation.kind) {
			case "account":
				if (operation.action === "create")
					outcome = await runWrite(issues, () =>
						createAccount(operation.row as unknown as AccountBody, options),
					);
				else if (operation.action === "update")
					outcome = await runWrite(issues, () =>
						updateAccount(
							operation.id,
							operation.row as unknown as AccountBody,
							options,
						),
					);
				else if (operation.action === "delete")
					outcome = await runWrite(issues, () =>
						deleteAccount(operation.id, options),
					);
				else
					outcome = await runWrite(issues, () =>
						moveAccount(
							{ id: operation.id, beforeId: operation.beforeId ?? "" },
							options,
						),
					);
				break;
			case "posting":
				if (operation.action === "create")
					outcome = await runWrite(issues, () =>
						createPosting(operation.row as unknown as PostingBody, options),
					);
				else if (operation.action === "update")
					outcome = await runWrite(issues, () =>
						updatePosting(
							operation.id,
							operation.row as unknown as PostingBody,
							options,
						),
					);
				else if (operation.action === "delete")
					outcome = await runWrite(issues, () =>
						deletePosting(operation.id, options),
					);
				else
					outcome = await runWrite(issues, () =>
						movePosting(
							{ id: operation.id, beforeId: operation.beforeId ?? "" },
							options,
						),
					);
				break;
			case "rule":
				if (operation.action === "create")
					outcome = await runWrite(issues, () =>
						createRule(operation.row as unknown as RuleBody, options),
					);
				else if (operation.action === "update")
					outcome = await runWrite(issues, () =>
						updateRule(
							operation.id,
							operation.row as unknown as RuleBody,
							options,
						),
					);
				else if (operation.action === "delete")
					outcome = await runWrite(issues, () =>
						deleteRule(operation.id, options),
					);
				else
					outcome = await runWrite(issues, () =>
						moveRule(
							{ id: operation.id, beforeId: operation.beforeId ?? "" },
							options,
						),
					);
				break;
			case "checkpoint":
				if (operation.action === "save")
					outcome = await runWrite(issues, () =>
						saveCheckpoint(operation.row as unknown as Checkpoint, options),
					);
				else
					outcome = await runWrite(issues, () =>
						deleteCheckpoint(
							{ accountId: operation.accountId, date: operation.date },
							options,
						),
					);
				break;
			case "evaluation":
				if (operation.action === "create")
					outcome = await runWrite(issues, () =>
						createEvaluation(
							{
								...operation.row,
								type: operation.evaluationType,
							} as EvaluationUpdate,
							options,
						),
					);
				else if (operation.action === "update")
					outcome = await runWrite(issues, () =>
						updateEvaluation(
							operation.instanceId,
							{
								...operation.row,
								type: operation.evaluationType,
							} as EvaluationUpdate,
							options,
						),
					);
				else if (operation.action === "delete")
					outcome = await runWrite(issues, () =>
						deleteEvaluation(operation.instanceId, options),
					);
				else
					outcome = await runWrite(issues, () =>
						moveEvaluation(
							{
								type: operation.evaluationType,
								instanceId: operation.instanceId,
								beforeId: operation.beforeId ?? "",
							},
							options,
						),
					);
				break;
		}
		if (outcome instanceof Error) return outcome;
		if (outcome !== null) return { ok: false, issues: outcome };
	}
	return { ok: true, issues };
}
