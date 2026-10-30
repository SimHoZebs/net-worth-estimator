import type { Posting, RecurrenceRule } from "../../api/contracts.ts";
import type { PostingAmountResolution } from "@/api/generated/model/postingAmountResolution.ts";
import type { PostingBody } from "@/api/generated/model/postingBody.ts";
import type { RuleBody } from "@/api/generated/model/ruleBody.ts";
import type { Transaction } from "../../domain/model.ts";
import { parseDisplayNumber } from "./formValues.ts";

export interface TransactionFormValues {
	name: string;
	amount: number;
	annualIncrease: number;
	fromId: string | null;
	toId: string | null;
	frequency: Transaction["frequency"];
	startDate: string;
	endDate: string | null;
	postedDate: string | null;
	enabled: boolean;
	claimRuleId: string | null;
	claimOccurrenceDate: string | null;
}

export function midnightOfDay(day: string): number {
	return Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);
}

/**
 * Literal amount descriptor. A non-zero annual increase rides as a
 * growth-factor provider input, the same shape the adapter reads and writes,
 * so rules round-trip without dedicated backend columns.
 */
export function transactionAmountDescriptor(
	amount: number,
	annualIncrease: number,
): PostingAmountResolution {
	const expression = String(amount);
	if (!annualIncrease)
		return { resolver: "expression", config: { expression }, inputs: {} };
	return {
		resolver: "expression",
		config: { expression: `(${expression}) * growth` },
		inputs: {
			growth: {
				source: "provider",
				provider: "growth-factor",
				arguments: { annualGrowthRate: annualIncrease / 100 },
			},
		},
	};
}

/** Raw stored amount as a request amount. Wire shapes match; the cast only
 * bridges the generated and canonical type aliases. */
function rawAmount(amount: Posting["amount"]): PostingAmountResolution {
	return amount as unknown as PostingAmountResolution;
}

/**
 * Explicit new posting body for creates and posting conversions. Every
 * authored field is stated outright; nothing is preserved.
 */
export function postingBody(values: TransactionFormValues): PostingBody {
	return {
		name: values.name,
		amount: transactionAmountDescriptor(values.amount, 0),
		enabled: values.enabled,
		...(values.fromId ? { sourceAccountId: values.fromId } : {}),
		destinations: values.toId ? [values.toId] : null,
		postedTime: midnightOfDay(values.postedDate ?? values.startDate),
		transactionTime: midnightOfDay(values.startDate),
		// Pending is server-owned bank metadata and is never authored here.
		...(values.claimRuleId && values.claimOccurrenceDate
			? {
					claim: {
						ruleId: values.claimRuleId,
						occurrenceDate: values.claimOccurrenceDate,
					},
				}
			: {}),
	};
}

/**
 * Explicit new rule body for creates and rule conversions. Priority and caps
 * stay omitted so the server appends and defaults them.
 */
export function ruleBody(values: TransactionFormValues): RuleBody {
	return {
		name: values.name,
		amount: transactionAmountDescriptor(values.amount, values.annualIncrease),
		enabled: values.enabled,
		frequency: values.frequency === "yearly" ? "annual" : "monthly",
		startDate: values.startDate,
		...(values.endDate ? { endDate: values.endDate } : {}),
		...(values.fromId ? { sourceAccountId: values.fromId } : {}),
		destinations: values.toId ? [values.toId] : null,
	};
}

function sameEndpoints(
	values: TransactionFormValues,
	baseline: Transaction,
): boolean {
	return values.fromId === baseline.fromId && values.toId === baseline.toId;
}

/**
 * Update posting body. The backend replaces the full authored row, so every
 * unedited field is carried over verbatim from the canonical raw row:
 * exact timestamps (not midnight), the raw amount descriptor (custom
 * resolvers and extra inputs survive name-only edits), full destination
 * arrays, the purchase policy the editor never models, and the stored claim
 * unless the edit changes it. Only edited fields are rebuilt.
 */
export function postingUpdateBody({
	baseline,
	raw,
	values,
}: {
	baseline: Transaction;
	raw: Posting;
	values: TransactionFormValues;
}): PostingBody {
	const endpointsChanged = !sameEndpoints(values, baseline);
	const amountChanged = values.amount !== baseline.amount;
	const startChanged = values.startDate !== baseline.startDate;
	const postedChanged = (values.postedDate ?? null) !== baseline.postedDate;
	const claimChanged =
		(values.claimRuleId ?? null) !== baseline.claimRuleId ||
		(values.claimOccurrenceDate ?? null) !== baseline.claimOccurrenceDate;
	return {
		name: values.name,
		amount: amountChanged
			? transactionAmountDescriptor(values.amount, 0)
			: rawAmount(raw.amount),
		enabled: values.enabled,
		...(endpointsChanged
			? {
					...(values.fromId ? { sourceAccountId: values.fromId } : {}),
					destinations: values.toId ? [values.toId] : null,
				}
			: {
					...(raw.sourceAccountId
						? { sourceAccountId: raw.sourceAccountId }
						: {}),
					destinations: raw.destinations,
				}),
		postedTime: postedChanged
			? midnightOfDay(values.postedDate ?? values.startDate)
			: raw.postedTime,
		transactionTime: startChanged
			? midnightOfDay(values.startDate)
			: raw.transactionTime,
		// The editor never models the wishlist link; the backend replaces the
		// row, so an omitted purchase would wipe it.
		...(raw.purchase ? { purchase: raw.purchase } : {}),
		...(claimChanged
			? values.claimRuleId && values.claimOccurrenceDate
				? {
						claim: {
							ruleId: values.claimRuleId,
							occurrenceDate: values.claimOccurrenceDate,
						},
					}
				: {}
			: raw.claim
				? { claim: { ...raw.claim } }
				: {}),
	};
}

/**
 * Update rule body. Unedited config rides verbatim: exact amount descriptor,
 * raw frequency string, annual cap, priority, full destinations, and end
 * date. The backend also keeps omitted priority/caps and echo-kept single
 * destinations, but stating stored values keeps one code path.
 */
export function ruleUpdateBody({
	baseline,
	raw,
	values,
}: {
	baseline: Transaction;
	raw: RecurrenceRule;
	values: TransactionFormValues;
}): RuleBody {
	const endpointsChanged = !sameEndpoints(values, baseline);
	const amountChanged =
		values.amount !== baseline.amount ||
		values.annualIncrease !== baseline.annualIncrease;
	const frequencyChanged = values.frequency !== baseline.frequency;
	const endChanged = (values.endDate ?? null) !== baseline.endDate;
	return {
		name: values.name,
		amount: amountChanged
			? transactionAmountDescriptor(values.amount, values.annualIncrease)
			: rawAmount(raw.amount),
		enabled: values.enabled,
		frequency: frequencyChanged
			? values.frequency === "yearly"
				? "annual"
				: "monthly"
			: raw.frequency,
		startDate:
			values.startDate === baseline.startDate
				? raw.startDate
				: values.startDate,
		...(endChanged
			? values.endDate
				? { endDate: values.endDate }
				: {}
			: raw.endDate
				? { endDate: raw.endDate }
				: {}),
		...(raw.annualCap != null ? { annualCap: raw.annualCap } : {}),
		priority: raw.priority,
		...(endpointsChanged
			? {
					...(values.fromId ? { sourceAccountId: values.fromId } : {}),
					destinations: values.toId ? [values.toId] : null,
				}
			: {
					...(raw.sourceAccountId
						? { sourceAccountId: raw.sourceAccountId }
						: {}),
					destinations: raw.destinations,
				}),
	};
}

/**
 * Subscription claim body: the original posting raw row with only the claim
 * changed. Timestamps, amount descriptor, destinations, and purchase policy
 * stay byte-identical; the source posting is preserved, never rebuilt.
 */
export function claimPostingBody(
	raw: Posting,
	ruleId: string,
	occurrenceDate: string,
): PostingBody {
	return {
		name: raw.name,
		amount: rawAmount(raw.amount),
		enabled: raw.enabled,
		...(raw.sourceAccountId ? { sourceAccountId: raw.sourceAccountId } : {}),
		destinations: raw.destinations,
		postedTime: raw.postedTime,
		transactionTime: raw.transactionTime,
		claim: { ruleId, occurrenceDate },
		...(raw.purchase ? { purchase: raw.purchase } : {}),
	};
}

/** Shared client-side validation for row transaction forms. */
export function validateTransactionValues(
	values: TransactionFormValues,
): string | null {
	if (!values.name.trim()) return "Give the transaction a name.";
	if (
		!Number.isFinite(values.amount) ||
		values.amount < 0 ||
		values.amount > 1e10
	)
		return "Enter an amount of zero or more.";
	if (!values.fromId && !values.toId)
		return "Choose a source or destination account.";
	if (!values.startDate) return "Choose a date.";
	if (
		values.frequency !== "once" &&
		values.endDate &&
		values.endDate < values.startDate
	)
		return "The last occurrence cannot come before the first one.";
	if (
		values.frequency !== "once" &&
		(!Number.isFinite(values.annualIncrease) ||
			values.annualIncrease < -50 ||
			values.annualIncrease > 50)
	)
		return "Enter a yearly increase between -50 and 50 percent.";
	return null;
}

export function parseAmountInput(raw: string): number | null {
	return parseDisplayNumber(raw);
}

/** Form values from the in-place detail draft. */
export function detailFormValues({
	draft,
	item,
	isOnce,
}: {
	draft: {
		name: string;
		amount: string;
		fromId: string;
		toId: string;
		frequency: Transaction["frequency"];
		startDate: string;
		endDate: string;
		noEndDate: boolean;
		annualIncrease: string;
		enabled: boolean;
		claimRuleId: string;
		claimOccurrenceDate: string;
		postedDate: string;
	};
	item: Transaction;
	isOnce: boolean;
}): TransactionFormValues | Error {
	const name = draft.name.trim();
	const amount = parseDisplayNumber(draft.amount);
	if (name === "") return new Error("Give the transaction a name.");
	if (amount === null || amount < 0 || amount > 1e10)
		return new Error("Enter an amount of zero or more.");
	const fromId = draft.fromId || null;
	const toId = draft.toId || null;
	if (!fromId && !toId)
		return new Error("Choose a source or destination account.");
	if (!draft.startDate) return new Error("Choose a date.");
	const growth =
		!isOnce && draft.annualIncrease.trim() !== ""
			? (parseDisplayNumber(draft.annualIncrease) ?? Number.NaN)
			: 0;
	if (!isOnce && (!Number.isFinite(growth) || growth < -50 || growth > 50))
		return new Error("Enter a yearly increase between -50 and 50 percent.");
	if (
		!isOnce &&
		!draft.noEndDate &&
		draft.endDate &&
		draft.endDate < draft.startDate
	)
		return new Error("The last occurrence cannot come before the first one.");
	return {
		name,
		amount,
		annualIncrease: isOnce ? 0 : growth,
		fromId,
		toId,
		frequency: draft.frequency,
		startDate: draft.startDate,
		endDate:
			!isOnce && !draft.noEndDate && draft.endDate ? draft.endDate : null,
		postedDate: draft.postedDate || item.postedDate,
		enabled: draft.enabled,
		claimRuleId: isOnce && draft.claimRuleId ? draft.claimRuleId : null,
		claimOccurrenceDate:
			isOnce && draft.claimRuleId && draft.claimOccurrenceDate
				? draft.claimOccurrenceDate
				: null,
	};
}
