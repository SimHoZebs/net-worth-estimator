import type { ScheduleAmendBody } from "@/api/generated/model/scheduleAmendBody.ts";
import type { ScheduleCreateBody } from "@/api/generated/model/scheduleCreateBody.ts";
import type { ScheduleRescheduleBody } from "@/api/generated/model/scheduleRescheduleBody.ts";
import type { TransactionAmendBody } from "@/api/generated/model/transactionAmendBody.ts";
import type { TransactionClaimBody } from "@/api/generated/model/transactionClaimBody.ts";
import type { TransactionRecordBody } from "@/api/generated/model/transactionRecordBody.ts";
import type { Transaction } from "../../domain/model.ts";
import { parseDisplayNumber } from "./formValues.ts";

/**
 * Editor vocabulary for the recurrence choice on a form. A one-time row, or
 * the monthly/yearly cadence the editor offers. Stored schedules may carry
 * any cadence; edits that leave the choice untouched keep the raw stored
 * value.
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
	claimScheduleId: string | null;
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
 * schedules, an optional yearly growth percent. The server compiles the
 * stored resolution descriptor, so the client never authors resolver input. */
function authoredAmount(amount: number, annualIncrease: number) {
	return annualIncrease ? { value: amount, annualIncrease } : { value: amount };
}

/**
 * Explicit new transaction body for creates. Every authored field is stated
 * outright; lifecycle state belongs to the server.
 */
export function postingBody(
	values: TransactionFormValues,
): TransactionRecordBody {
	return {
		name: values.name,
		amount: authoredAmount(values.amount, 0),
		enabled: values.enabled,
		date: values.startDate,
		...(values.transactionTime
			? { time: timeOfDay(values.transactionTime) }
			: {}),
		...(values.postedDate ? { postedDate: values.postedDate } : {}),
		...(values.fromId ? { sourceAccountId: values.fromId } : {}),
		destinations: values.toId ? [values.toId] : null,
		...(values.claimScheduleId && values.claimOccurrenceDate
			? {
					claim: {
						scheduleId: values.claimScheduleId,
						occurrenceDate: values.claimOccurrenceDate,
					},
				}
			: {}),
	};
}

/** Editor choice matching a stored schedule cadence: annual reads as yearly. */
export function frequencyChoiceOf(rawFrequency: string): FrequencyChoice {
	return rawFrequency === "annual" ? "yearly" : "monthly";
}

/**
 * Explicit new schedule body for creates. Priority and caps stay omitted so
 * the server appends and defaults them.
 */
export function ruleBody(values: TransactionFormValues): ScheduleCreateBody {
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
 * Transaction amend: only the members the edit changed. Absent members keep
 * their stored values on the server, so exact timestamps, amount descriptors,
 * and extra destinations never need to be restated.
 */
export function postingUpdate({
	baseline,
	values,
}: {
	baseline: Transaction;
	values: TransactionFormValues;
}): TransactionAmendBody {
	const patch: TransactionAmendBody = {};
	if (values.name !== baseline.name) patch.name = values.name;
	if (values.fromId !== baseline.fromId)
		patch.sourceAccountId = values.fromId ?? null;
	if (values.toId !== baseline.toId)
		patch.destinations = values.toId ? [values.toId] : null;
	if (values.amount !== baseline.amount)
		patch.amount = authoredAmount(values.amount, 0);
	if (values.startDate !== baseline.startDate) patch.date = values.startDate;
	const storedTime = timeOfDay(baseline.transactionTime);
	const editedTime =
		typeof values.transactionTime === "number"
			? timeOfDay(values.transactionTime)
			: storedTime;
	if (editedTime !== storedTime)
		patch.time = editedTime === "" ? null : editedTime;
	if ((values.postedDate ?? null) !== baseline.postedDate)
		patch.postedDate = values.postedDate ?? null;
	if (values.enabled !== baseline.enabled) patch.enabled = values.enabled;
	return patch;
}

/**
 * Schedule terms an edit changes. The stored cadence is passed in because the
 * display row never carries it; without it the reschedule leg is omitted and
 * the server keeps the stored cadence.
 */
export function ruleUpdate({
	baseline,
	values,
	storedFrequency,
}: {
	baseline: Transaction;
	values: TransactionFormValues;
	storedFrequency?: string;
}): { amend: ScheduleAmendBody; reschedule: ScheduleRescheduleBody } {
	const amend: ScheduleAmendBody = {};
	const reschedule: ScheduleRescheduleBody = {};
	if (values.name !== baseline.name) amend.name = values.name;
	if (
		values.amount !== baseline.amount ||
		values.annualIncrease !== baseline.annualIncrease
	)
		amend.amount = authoredAmount(values.amount, values.annualIncrease);
	if (values.fromId !== baseline.fromId)
		amend.sourceAccountId = values.fromId ?? null;
	if (values.toId !== baseline.toId)
		amend.destinations = values.toId ? [values.toId] : null;
	if (values.enabled !== baseline.enabled) amend.enabled = values.enabled;
	if (
		storedFrequency !== undefined &&
		values.frequency !== frequencyChoiceOf(storedFrequency)
	)
		reschedule.frequency = values.frequency === "yearly" ? "annual" : "monthly";
	if (values.startDate !== baseline.startDate)
		reschedule.startDate = values.startDate;
	if ((values.endDate ?? null) !== baseline.endDate)
		reschedule.endDate = values.endDate ?? null;
	return { amend, reschedule };
}

/** Occurrence claim: one link changes, every other stored value stays. */
export function claimUpdate(
	scheduleId: string,
	occurrenceDate: string,
): TransactionClaimBody {
	return { scheduleId, occurrenceDate };
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
	if (values.claimScheduleId && !values.claimOccurrenceDate)
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
		claimScheduleId: string;
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
	if (isOnce && draft.claimScheduleId && !draft.claimOccurrenceDate)
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
					? (item.transactionTime ?? null)
					: combineDayTime(draft.startDate, draft.transactionTime)
				: undefined,
		enabled: draft.enabled,
		claimScheduleId:
			isOnce && draft.claimScheduleId ? draft.claimScheduleId : null,
		claimOccurrenceDate:
			isOnce && draft.claimScheduleId && draft.claimOccurrenceDate
				? draft.claimOccurrenceDate
				: null,
	};
}
