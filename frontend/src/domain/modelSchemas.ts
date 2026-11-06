import { z } from "zod";

// Schema values live apart from the display model so importing domain types
// never places the validator in a boot chunk. Only forms that validate
// user-supplied rows load this module.
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
	// Latest observation at or before the viewed date, separate from the
	// adjusted modeled balance above. Missing means unobserved.
	observedBalance: z
		.number()
		.finite()
		.min(-1e10)
		.max(1e10)
		.nullable()
		.optional(),
	observedAt: z.number().int().nullable().optional(),
	// Bank-reported available cash or available credit. Missing means the
	// Bridge did not report it; it never replaces the posted balance.
	availableBalance: z
		.number()
		.finite()
		.min(-1e10)
		.max(1e10)
		.nullable()
		.optional(),
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

export const transactionSchema = z.object({
	id,
	name,
	amount: money,
	amountKnown: z.boolean().default(true),
	fromId: id.nullable(),
	toId: id.nullable(),
	// Which record this is: a one-time transaction or a schedule. The
	// schedule itself lives on the schedule record; the row only carries
	// the tag.
	kind: z.enum(["posting", "schedule"]),
	startDate: date,
	endDate: date.nullable(),
	annualIncrease: z.number().min(-50).max(50),
	enabled: z.boolean(),
	readOnly: z.boolean(),
	// Manual link to a schedule occurrence. Only meaningful for
	// one-time transactions; the server validates the named occurrence.
	claimScheduleId: id.nullable().default(null),
	claimOccurrenceDate: date.nullable().default(null),
	// Display-only day the one-time transaction settled, when it differs
	// from the transaction day (startDate). Schedules never carry one.
	// Editors preserve exact timestamps from the canonical stored row.
	postedDate: date.nullable().default(null),
	// Server-owned bank lifecycle metadata. Missing means not pending.
	pending: z.boolean().optional(),
	// Void marks a bank hold that vanished without posting. The UI shows
	// it as "Did not post". Every transaction carries it explicitly.
	void: z.boolean(),
	// Bank-owned row (importer output). Settled bank rows participate
	// like manual actuals; only an owner-disabled row counts as excluded.
	// Pending and void bank rows are recorded bank evidence, never an
	// exclusion.
	syncOwned: z.boolean().optional(),
	// Category is the current sidecar assignment shared with the bank and
	// classifier. Null means uncategorized. Source says who supplied it:
	// "bank", "inferred", or "user". Categories never affect projections.
	category: z.string().nullable().optional(),
	categorySource: z.enum(["bank", "inferred", "user"]).nullable().optional(),
	// Exact Unix transaction time. Day display stays on startDate; the
	// instant orders intraday execution.
	transactionTime: z.number().int().nullable().optional(),
	// Receipt IDs attached to this posting. Read with the row list so a
	// receipt badge does not need the full model document.
	receiptIds: z.array(z.string()).optional(),
});

export const evaluationSchema = z.object({
	id,
	name,
	kind: z.enum(["net-worth", "reserve"]),
	target: money.positive(),
	accountId: id.nullable(),
	enabled: z.boolean(),
});

export type Account = z.infer<typeof accountSchema>;
export type Transaction = z.infer<typeof transactionSchema>;
export type PlannedPurchase = z.infer<typeof plannedPurchaseSchema>;
export type Evaluation = z.infer<typeof evaluationSchema>;
