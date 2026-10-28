import { z } from "zod";

export const accountKindSchema = z.enum([
	"cash",
	"investment",
	"debt",
	"property",
]);
const date = z.iso.date();
const money = z.number().finite().min(0).max(1e10);
const id = z.string().min(1).max(100);
const name = z.string().trim().min(1).max(100);

export const accountSchema = z.object({
	id,
	name,
	kind: accountKindSchema,
	enabled: z.boolean().default(true),
	archived: z.boolean().default(false),
	balance: z.number().finite().min(-1e10).max(1e10),
	minBalance: money,
	maxBalance: money.nullable(),
	color: z.string().max(100).nullable().default(null),
	observedOn: date,
	balanceCheck: z.boolean(),
	source: name,
	readOnly: z.boolean(),
});

export const plannedPurchaseSchema = z.object({
	id,
	name,
	amount: z.number().finite().positive().max(1e10),
	fromId: id.nullable(),
	startDate: date,
	enabled: z.boolean(),
	readOnly: z.boolean(),
});

export const movementSchema = z.object({
	id,
	name,
	amount: money,
	amountKnown: z.boolean().default(true),
	fromId: id.nullable(),
	toId: id.nullable(),
	frequency: z.enum(["monthly", "yearly", "once"]),
	startDate: date,
	endDate: date.nullable(),
	annualIncrease: z.number().min(-50).max(50),
	enabled: z.boolean(),
	readOnly: z.boolean(),
	// Manual link to a recurrence rule occurrence. Only meaningful for
	// one-time movements; the server validates the named occurrence.
	claimRuleId: id.nullable().default(null),
	claimOccurrenceDate: date.nullable().default(null),
	// Display-only day the one-time posting settled, when it differs from
	// the transaction day (startDate). Recurring rules never carry one, and
	// reverse conversion ignores it: the server times round-trip through
	// stored extras instead.
	postedDate: date.nullable().default(null),
	// Server-owned bank lifecycle metadata. Missing means not pending.
	pending: z.boolean().optional(),
	// Void marks a bank hold that vanished without posting. The UI shows
	// it as "Did not post". Every movement carries it explicitly; stored
	// drafts without it migrate to false on load.
	void: z.boolean(),
});

/**
 * A movement is historical when it is a one-time dated record at or before the
 * projection start. Recurring rules and later-dated movements are projected.
 * Planned purchases live in their own slice and never count as history.
 */
export function isHistoricalMovement(
	movement: Movement,
	projectionStartDate: string,
): boolean {
	return (
		movement.frequency === "once" && movement.startDate <= projectionStartDate
	);
}

/** Pending state comes from bank metadata, never the posting ID. */
export function isPendingMovement(
	movement: Pick<Movement, "pending">,
): boolean {
	return movement.pending === true;
}

export const evaluationSchema = z.object({
	id,
	name,
	kind: z.enum(["net-worth", "reserve"]),
	target: money.positive(),
	accountId: id.nullable(),
	enabled: z.boolean(),
});

function migrateLegacyEvaluations(value: unknown): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return value;
	const record = value as Record<string, unknown>;
	if (record.evaluations === undefined && Array.isArray(record.goals))
		return { ...record, evaluations: record.goals };
	return value;
}

function migrateLegacyVoidFlag(value: unknown): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return value;
	const record = value as Record<string, unknown>;
	if (!Array.isArray(record.movements)) return value;
	let changed = false;
	const movements = record.movements.map((movement) => {
		if (typeof movement !== "object" || movement === null || "void" in movement)
			return movement;
		changed = true;
		return { ...(movement as Record<string, unknown>), void: false };
	});
	return changed ? { ...record, movements } : value;
}

/**
 * Legacy drafts stored wishlist items as movements carrying
 * `purchasePriority`. The display plan now keeps them in
 * `plannedPurchases` ordered by priority, so lift them out before parsing:
 * zod strips unknown movement keys, which would otherwise turn old wishes
 * into real one-time postings.
 */
function migrateLegacyPurchases(value: unknown): unknown {
	if (typeof value !== "object" || value === null || Array.isArray(value))
		return value;
	const record = value as Record<string, unknown>;
	if (!Array.isArray(record.movements)) return value;
	const planned: Record<string, unknown>[] = Array.isArray(
		record.plannedPurchases,
	)
		? [...(record.plannedPurchases as Record<string, unknown>[])]
		: [];
	const movements: unknown[] = [];
	for (const item of record.movements) {
		if (
			typeof item === "object" &&
			item !== null &&
			(item as Record<string, unknown>).purchasePriority != null &&
			typeof (item as Record<string, unknown>).fromId === "string"
		) {
			const movement = item as Record<string, unknown>;
			planned.push({
				id: movement.id,
				name: movement.name,
				amount: movement.amount,
				fromId: movement.fromId,
				startDate: movement.startDate,
				enabled: movement.enabled ?? true,
				readOnly: movement.readOnly ?? false,
				__priority:
					typeof movement.purchasePriority === "number"
						? movement.purchasePriority
						: 0,
			});
		} else {
			movements.push(item);
		}
	}
	planned.sort(
		(left, right) =>
			Number(left.__priority ?? 0) - Number(right.__priority ?? 0),
	);
	for (const item of planned) delete item.__priority;
	return { ...record, movements, plannedPurchases: planned };
}

function migrateLegacyPlan(value: unknown): unknown {
	return migrateLegacyVoidFlag(
		migrateLegacyPurchases(migrateLegacyEvaluations(value)),
	);
}

export const planSchema = z.preprocess(
	migrateLegacyPlan,
	z
		.object({
			schemaVersion: z.literal(1),
			name,
			origin: z.enum(["example", "personal"]),
			startDate: date,
			updatedAt: z.iso.datetime(),
			revision: z.number().int().min(1),
			readOnly: z.boolean(),
			accounts: z.array(accountSchema).max(50),
			movements: z.array(movementSchema).max(300),
			plannedPurchases: z.array(plannedPurchaseSchema).max(100).default([]),
			evaluations: z.array(evaluationSchema).max(30),
			assumptions: z.object({
				inflation: z.number().min(0).max(20),
				volatility: z.number().min(0).max(40),
			}),
		})
		.superRefine((plan, context) => {
			const ids = new Set<string>();
			const issue = (path: (string | number)[], message: string) =>
				context.addIssue({ code: "custom", path, message });
			for (const [index, account] of plan.accounts.entries()) {
				if (ids.has(account.id))
					issue(["accounts", index, "id"], "Account IDs must be unique.");
				ids.add(account.id);
				if (account.kind === "debt" && account.balance > 0)
					issue(
						["accounts", index, "balance"],
						"Enter debt as a negative balance.",
					);
				if (account.kind !== "debt" && account.balance < 0)
					issue(
						["accounts", index, "balance"],
						"Asset balances cannot be negative.",
					);
				if (
					account.maxBalance !== null &&
					account.maxBalance < account.minBalance
				)
					issue(
						["accounts", index, "maxBalance"],
						"The maxBalance must be at least the protected balance.",
					);
				if (account.observedOn > plan.startDate)
					issue(
						["accounts", index, "observedOn"],
						"A balance cannot be dated after the projection start.",
					);
			}
			const movementIds = new Set<string>();
			for (const [index, movement] of plan.movements.entries()) {
				if (movementIds.has(movement.id))
					issue(["movements", index, "id"], "Transaction IDs must be unique.");
				movementIds.add(movement.id);
				if (!movement.fromId && !movement.toId)
					issue(
						["movements", index],
						"Choose a source or destination account.",
					);
				if (movement.fromId && movement.fromId === movement.toId)
					issue(["movements", index], "Source and destination must differ.");
				for (const key of ["fromId", "toId"] as const) {
					if (movement[key] && !ids.has(movement[key]))
						issue(["movements", index, key], "Choose an existing account.");
				}

				if (movement.endDate && movement.endDate < movement.startDate)
					issue(
						["movements", index, "endDate"],
						"End date must follow the first occurrence.",
					);
			}
			for (const [index, purchase] of plan.plannedPurchases.entries()) {
				if (movementIds.has(purchase.id))
					issue(
						["plannedPurchases", index, "id"],
						"Planned purchase IDs must be unique across transactions and purchases.",
					);
				movementIds.add(purchase.id);
				if (purchase.fromId === null || !ids.has(purchase.fromId))
					issue(
						["plannedPurchases", index, "fromId"],
						"A planned purchase needs a funding account that exists.",
					);
			}
			const evaluationIds = new Set<string>();
			for (const [index, evaluation] of plan.evaluations.entries()) {
				if (evaluationIds.has(evaluation.id))
					issue(["evaluations", index, "id"], "Evaluation IDs must be unique.");
				evaluationIds.add(evaluation.id);
				if (
					evaluation.kind === "reserve" &&
					(!evaluation.accountId || !ids.has(evaluation.accountId))
				)
					issue(
						["evaluations", index, "accountId"],
						"Select the account for this reserve evaluation.",
					);
			}
		}),
);

export type Account = z.infer<typeof accountSchema>;
export type Movement = z.infer<typeof movementSchema>;
export type PlannedPurchase = z.infer<typeof plannedPurchaseSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;
export type Plan = z.infer<typeof planSchema>;

export function validatePlan(value: unknown): Plan | Error {
	const result = planSchema.safeParse(value);
	if (!result.success)
		return new Error(
			result.error.issues
				.map((item) => `${item.path.join(".")}: ${item.message}`)
				.join("\n"),
		);
	return result.data;
}

export function netWorth(plan: Plan) {
	return plan.accounts
		.filter((account) => account.enabled && !account.archived)
		.reduce((sum, account) => sum + account.balance, 0);
}

export function isArchivedAccount(account: Pick<Account, "archived">): boolean {
	return account.archived === true;
}

export function visibleAccounts(accounts: Account[]): Account[] {
	return accounts.filter((account) => !account.archived);
}

export function visibleMovements({
	movements,
	accounts,
}: {
	movements: Movement[];
	accounts: Account[];
}): Movement[] {
	const archivedIds = new Set(
		accounts.filter((account) => account.archived).map((account) => account.id),
	);
	if (!archivedIds.size) return movements;
	return movements.filter(
		(movement) =>
			!(movement.fromId && archivedIds.has(movement.fromId)) &&
			!(movement.toId && archivedIds.has(movement.toId)),
	);
}

export function visiblePlannedPurchases({
	plannedPurchases,
	accounts,
}: {
	plannedPurchases: PlannedPurchase[];
	accounts: Account[];
}): PlannedPurchase[] {
	const archivedIds = new Set(
		accounts.filter((account) => account.archived).map((account) => account.id),
	);
	if (!archivedIds.size) return plannedPurchases;
	return plannedPurchases.filter(
		(purchase) => !(purchase.fromId && archivedIds.has(purchase.fromId)),
	);
}

export function changesBetween({
	saved,
	current,
}: {
	saved: Plan;
	current: Plan;
}) {
	const changes: {
		label: string;
		kind: "Added" | "Modified" | "Removed";
		before: string;
		after: string;
	}[] = [];
	for (const key of [
		"accounts",
		"movements",
		"plannedPurchases",
		"evaluations",
	] as const) {
		// Order is meaningful (queue priority, execution order), so a pure
		// reorder must stage a draft even when every record is unchanged.
		const beforeIds = saved[key].map((item) => item.id);
		const afterIds = current[key].map((item) => item.id);
		if (
			beforeIds.length === afterIds.length &&
			beforeIds.some((id, index) => afterIds[index] !== id) &&
			beforeIds.every((id) => afterIds.includes(id))
		)
			changes.push({
				label: "Order",
				kind: "Modified",
				before: beforeIds.join(","),
				after: afterIds.join(","),
			});
		for (const item of current[key]) {
			const previous = saved[key].find((old) => old.id === item.id);
			if (!previous)
				changes.push({
					label: item.name,
					kind: "Added",
					before: "",
					after: JSON.stringify(item),
				});
			else if (JSON.stringify(previous) !== JSON.stringify(item))
				changes.push({
					label: item.name,
					kind: "Modified",
					before: JSON.stringify(previous),
					after: JSON.stringify(item),
				});
		}
		for (const item of saved[key]) {
			if (!current[key].some((next) => next.id === item.id))
				changes.push({
					label: item.name,
					kind: "Removed",
					before: JSON.stringify(item),
					after: "",
				});
		}
	}
	if (JSON.stringify(saved.assumptions) !== JSON.stringify(current.assumptions))
		changes.push({
			label: "Projection assumptions",
			kind: "Modified",
			before: JSON.stringify(saved.assumptions),
			after: JSON.stringify(current.assumptions),
		});
	if (saved.name !== current.name || saved.startDate !== current.startDate)
		changes.push({
			label: "Plan details",
			kind: "Modified",
			before: saved.name,
			after: current.name,
		});
	return changes;
}
