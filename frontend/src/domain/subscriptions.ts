import type { Transaction } from "./model.ts";

export type SubscriptionFrequency = "monthly" | "yearly";

export interface MarkAsRecurringOptions {
	/** Recurring cadence for the new rule. Defaults to monthly. */
	frequency?: SubscriptionFrequency;
	/** Last occurrence for installment-style rules. Null means ongoing. */
	endDate?: string | null;
	/** Override the generated rule id (tests). */
	ruleId?: string;
	/** Override id generation. */
	generateId?: () => string;
}

function daysInMonth(year: number, month: number): number {
	return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Clamped calendar-month addition, mirroring the backend schedule math. */
export function addMonthsClamped(startDate: string, months: number): string {
	const [year, month, day] = startDate.split("-").map(Number);
	const total = year! * 12 + (month! - 1) + months;
	const nextYear = Math.floor(total / 12);
	const nextMonth = (total % 12) + 1;
	const nextDay = Math.min(day!, daysInMonth(nextYear, nextMonth));
	const pad = (value: number) => String(value).padStart(2, "0");
	return `${nextYear}-${pad(nextMonth)}-${pad(nextDay)}`;
}

function isIsoDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split("-").map(Number);
	if (month! < 1 || month! > 12 || day! < 1 || day! > 31) return false;
	return day! <= daysInMonth(year!, month!);
}

/** Why a source row cannot become a subscription. Null means it can. */
export function subscriptionSourceError(source: Transaction): Error | null {
	if (source.frequency !== "once") {
		return new Error("Only one-time transactions can be marked as recurring.");
	}
	if (source.claimRuleId || source.claimOccurrenceDate) {
		return new Error(
			"That transaction already records a recurring occurrence.",
		);
	}
	if (source.readOnly || source.pending) {
		return new Error("Synced transactions cannot be marked as recurring.");
	}
	return null;
}

export interface SubscriptionConversion {
	rule: Transaction;
	claimed: Transaction;
}

/**
 * Pure row conversion: an ongoing recurrence rule cloned from the source
 * one-time posting, plus the source claimed as the rule's occurrence on
 * its own date. The source posting itself is preserved; callers persist
 * the rule first, then the claim, so a partial failure never loses data.
 */
export function buildSubscriptionConversion(
	source: Transaction,
	options: MarkAsRecurringOptions = {},
): SubscriptionConversion | Error {
	const blocked = subscriptionSourceError(source);
	if (blocked) return blocked;
	const frequency: SubscriptionFrequency = options.frequency ?? "monthly";
	const endDate = options.endDate ?? null;
	if (endDate !== null) {
		if (!isIsoDate(endDate)) {
			return new Error("The installment end date is not a calendar date.");
		}
		if (endDate < source.startDate) {
			return new Error("The last payment cannot come before the first one.");
		}
	}
	const generateId = options.generateId ?? (() => crypto.randomUUID());
	const ruleId = options.ruleId ?? generateId();
	const rule: Transaction = {
		id: ruleId,
		name: source.name,
		amount: source.amount,
		amountKnown: source.amountKnown,
		fromId: source.fromId,
		toId: source.toId,
		frequency,
		startDate: source.startDate,
		endDate,
		annualIncrease: 0,
		enabled: source.enabled,
		readOnly: false,
		claimRuleId: null,
		claimOccurrenceDate: null,
		postedDate: null,
		void: false,
	};
	const claimed: Transaction = {
		...source,
		claimRuleId: ruleId,
		claimOccurrenceDate: source.startDate,
	};
	return { rule, claimed };
}

/** Subscription shorthand: ongoing monthly rule, same conversion. */
export function buildSubscription(
	source: Transaction,
	options: MarkAsRecurringOptions = {},
): SubscriptionConversion | Error {
	return buildSubscriptionConversion(source, { ...options, endDate: null });
}

/** Installment shorthand: same rule + claim pair with a computed deadline. */
export function buildInstallment(
	source: Transaction,
	payments: number,
	options: MarkAsRecurringOptions = {},
): SubscriptionConversion | Error {
	if (!Number.isInteger(payments) || payments < 2 || payments > 600) {
		return new Error("Choose between 2 and 600 payments for an installment.");
	}
	const frequency: SubscriptionFrequency = options.frequency ?? "monthly";
	const step = frequency === "monthly" ? 1 : 12;
	return buildSubscriptionConversion(source, {
		...options,
		frequency,
		endDate: addMonthsClamped(source.startDate, step * (payments - 1)),
	});
}
