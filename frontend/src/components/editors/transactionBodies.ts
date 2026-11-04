import type { PostingBody } from "@/api/generated/model/postingBody.ts";
import type { PostingUpdateBody } from "@/api/generated/model/postingUpdateBody.ts";
import type { RuleBody } from "@/api/generated/model/ruleBody.ts";
import type { RuleUpdateBody } from "@/api/generated/model/ruleUpdateBody.ts";
import type { Transaction } from "../../domain/model.ts";
import { parseDisplayNumber } from "./formValues.ts";

/**
 * Editor vocabulary for the recurrence choice on a form. A one-time row, or
 * the monthly/yearly cadence the editor offers. Stored rules may carry any
 * cadence; edits that leave the choice untouched keep the raw stored value.
 */
export type FrequencyChoice = "monthly" | "yearly" | "once";

export interface TransactionFormValues {
	name: string;
	amount: number;
	annualIncrease: number;
	fromId: string | null;
	toId: string | null;
	frequency: FrequencyChoice;
	startDate: string;
	endDate: string | null;
	postedDate: string | null;
	enabled: boolean;
	claimRuleId: string | null;
	claimOccurrenceDate: string | null;
	transactionTime?: number | null;
}

export function midnightOfDay(day: string): number {
	return Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);
}

/** UTC wall time for the editor, with seconds when the stored instant has them. */
export function timeOfDay(stamp: number | null | undefined): string {
	if (typeof stamp !== "number" || stamp <= 0) return "";
	const time = new Date(stamp * 1000).toISOString().slice(11, 19);
	return time.endsWith(":00") ? time.slice(0, 5) : time;
}

export function combineDayTime(day: string, time: string): number {
	return time
		? Math.floor(new Date(`${day}T${time}Z`).getTime() / 1000)
		: midnightOfDay(day);
}

/** Authored amount in the API's semantic form: a literal value and, for
 * rules, an optional yearly growth percent. The server compiles the stored
 * resolution descriptor, so the client never authors resolver input. */
function authoredAmount(amount: number, annualIncrease: number) {
	return annualIncrease
		? { value: amount, annualIncrease }
		: { value: amount };
}

/**
 * Explicit new posting body for creates and posting conversions. Every
 * authored field is stated outright; nothing is preserved.
 */
export function postingBody(values: TransactionFormValues): PostingBody {
	return {
		name: values.name,
		amount: authoredAmount(values.amount, 0),
		enabled: values.enabled,
		...(values.fromId ? { sourceAccountId: values.fromId } : {}),
		destinations: values.toId ? [values.toId] : null,
		postedTime: midnightOfDay(values.postedDate ?? values.startDate),
		transactionTime: values.transactionTime ?? midnightOfDay(values.startDate),
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

/** Editor choice matching a stored rule cadence: annual reads as yearly. */
export function frequencyChoiceOf(rawFrequency: string): FrequencyChoice {
	return rawFrequency === "annual" ? "yearly" : "monthly";
}

/**
 * Explicit new rule body for creates and rule conversions. Priority and caps
 * stay omitted so the server appends and defaults them.
 */
export function ruleBody(values: TransactionFormValues): RuleBody {
	return {
		name: values.name,
		amount: authoredAmount(values.amount, values.annualIncrease),
		enabled: values.enabled,
		frequency: values.frequency === "yearly" ? "annual" : "monthly",
		startDate: values.startDate,
		...(values.endDate ? { endDate: values.endDate } : {}),
		...(values.fromId ? { sourceAccountId: values.fromId } : {}),
		destinations: values.toId ? [values.toId] : null,
	};
}

/**
 * Posting update: only the members the edit changed. Absent members keep
 * their stored values on the server, so exact timestamps, amount
 * descriptors, and extra destinations never need to be restated.
 */
export function postingUpdate({
	baseline,
	values,
}: {
	baseline: Transaction;
	values: TransactionFormValues;
}): PostingUpdateBody {
	const patch: PostingUpdateBody = {};
	if (values.name !== baseline.name) patch.name = values.name;
	if (values.fromId !== baseline.fromId)
		patch.sourceAccountId = values.fromId ?? null;
	if (values.toId !== baseline.toId)
		patch.destinations = values.toId ? [values.toId] : null;
	if (values.amount !== baseline.amount)
		patch.amount = authoredAmount(values.amount, 0);
	if ((values.postedDate ?? null) !== baseline.postedDate)
		patch.postedTime = midnightOfDay(values.postedDate ?? values.startDate);
	if (
		typeof values.transactionTime === "number" &&
		values.transactionTime !== baseline.transactionTime
	)
		patch.transactionTime = values.transactionTime;
	if (
		(values.claimRuleId ?? null) !== baseline.claimRuleId ||
		(values.claimOccurrenceDate ?? null) !== baseline.claimOccurrenceDate
	)
		patch.claim =
			values.claimRuleId && values.claimOccurrenceDate
				? {
						ruleId: values.claimRuleId,
						occurrenceDate: values.claimOccurrenceDate,
					}
				: null;
	if (values.enabled !== baseline.enabled) patch.enabled = values.enabled;
	return patch;
}

/**
 * Rule update: only the members the edit changed. The stored cadence is
 * passed in because the display row never carries it; without it the update
 * omits frequency and the server keeps the stored value.
 */
export function ruleUpdate({
	baseline,
	values,
	storedFrequency,
}: {
	baseline: Transaction;
	values: TransactionFormValues;
	storedFrequency?: string;
}): RuleUpdateBody {
	const patch: RuleUpdateBody = {};
	if (values.name !== baseline.name) patch.name = values.name;
	if (
		values.amount !== baseline.amount ||
		values.annualIncrease !== baseline.annualIncrease
	)
		patch.amount = authoredAmount(values.amount, values.annualIncrease);
	if (
		storedFrequency !== undefined &&
		values.frequency !== frequencyChoiceOf(storedFrequency)
	)
		patch.frequency = values.frequency === "yearly" ? "annual" : "monthly";
	if (values.startDate !== baseline.startDate)
		patch.startDate = values.startDate;
	if ((values.endDate ?? null) !== baseline.endDate)
		patch.endDate = values.endDate ?? null;
	if (values.fromId !== baseline.fromId)
		patch.sourceAccountId = values.fromId ?? null;
	if (values.toId !== baseline.toId)
		patch.destinations = values.toId ? [values.toId] : null;
	if (values.enabled !== baseline.enabled) patch.enabled = values.enabled;
	return patch;
}

/** Claim update: one member changes, every other stored value stays. */
export function claimUpdate(
	ruleId: string,
	occurrenceDate: string,
): PostingUpdateBody {
	return { claim: { ruleId, occurrenceDate } };
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
	if (values.claimRuleId && !values.claimOccurrenceDate)
		return "Choose which occurrence this replaces.";
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
		frequency: FrequencyChoice;
		startDate: string;
		endDate: string;
		noEndDate: boolean;
		annualIncrease: string;
		enabled: boolean;
		claimRuleId: string;
		claimOccurrenceDate: string;
		postedDate: string;
		transactionTime?: string;
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
	if (isOnce && draft.claimRuleId && !draft.claimOccurrenceDate)
		return new Error("Choose which occurrence this replaces.");
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
		transactionTime:
			isOnce && draft.transactionTime !== undefined
				? draft.startDate === item.startDate &&
					draft.transactionTime === timeOfDay(item.transactionTime)
					? item.transactionTime
					: combineDayTime(draft.startDate, draft.transactionTime)
				: undefined,
		enabled: draft.enabled,
		claimRuleId: isOnce && draft.claimRuleId ? draft.claimRuleId : null,
		claimOccurrenceDate:
			isOnce && draft.claimRuleId && draft.claimOccurrenceDate
				? draft.claimOccurrenceDate
				: null,
	};
}
