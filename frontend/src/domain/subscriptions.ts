import { isSyncReservedId, type Movement, type Plan } from "./model.ts";

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

/**
 * Mark a one-time transaction as a subscription: create an ongoing
 * recurrence rule from its details and claim the original transaction as
 * the rule's occurrence on its own date. The rule + claim pair is the
 * subscription; no extra backend field is needed because the backend
 * already persists rules and claims and the adapter round-trips both.
 */
export function markAsSubscription(
	plan: Plan,
	movementId: string,
	options: MarkAsRecurringOptions = {},
): Plan | Error {
	return markAsRecurring(plan, movementId, { ...options, endDate: null });
}

/**
 * Mark a one-time transaction as an installment plan (Klarna-style split,
 * loan payoff, fixed-length run): same rule + claim conversion as a
 * subscription, but the rule carries a deadline computed from a payment
 * count. Visualization needs no extra logic: the existing schedule display
 * already renders the first-to-last range.
 */
export function markAsInstallment(
	plan: Plan,
	movementId: string,
	payments: number,
	options: MarkAsRecurringOptions = {},
): Plan | Error {
	if (!Number.isInteger(payments) || payments < 2 || payments > 600) {
		return new Error("Choose between 2 and 600 payments for an installment.");
	}
	const source = plan.movements.find((item) => item.id === movementId);
	if (!source)
		return new Error("That transaction no longer exists in the plan.");
	const frequency: SubscriptionFrequency = options.frequency ?? "monthly";
	const step = frequency === "monthly" ? 1 : 12;
	return markAsRecurring(plan, movementId, {
		...options,
		frequency,
		endDate: addMonthsClamped(source.startDate, step * (payments - 1)),
	});
}

function markAsRecurring(
	plan: Plan,
	movementId: string,
	options: MarkAsRecurringOptions,
): Plan | Error {
	const source = plan.movements.find((item) => item.id === movementId);
	if (!source) {
		return new Error("That transaction no longer exists in the plan.");
	}
	if (source.frequency !== "once") {
		return new Error("Only one-time transactions can be marked as recurring.");
	}
	if (source.claimRuleId || source.claimOccurrenceDate) {
		return new Error(
			"That transaction already records a recurring occurrence.",
		);
	}
	if (source.readOnly || isSyncReservedId(source.id)) {
		return new Error("Synced transactions cannot be marked as recurring.");
	}
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
	if (plan.movements.some((item) => item.id === ruleId)) {
		return new Error("A transaction with that id already exists. Try again.");
	}
	const rule: Movement = {
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
	};
	const claimed: Movement = {
		...source,
		claimRuleId: ruleId,
		claimOccurrenceDate: source.startDate,
	};
	return {
		...plan,
		movements: plan.movements
			.map((item) => (item.id === movementId ? claimed : item))
			.concat([rule]),
	};
}
