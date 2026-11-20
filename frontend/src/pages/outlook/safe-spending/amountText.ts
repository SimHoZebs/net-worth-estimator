import { exactMoney } from "@/domain/format.ts";
import { SAFE_SPENDING_LABELS as labels } from "./safeSpendingLabels.ts";

/** Shared money rendering for the safe spending card and its drawers. A
 * missing value reads as a short status, never a dash or a fabricated zero. */
export const amountText = (
	value: number | null | undefined,
	missingText: string = labels.unavailable,
): string =>
	value === null || value === undefined
		? missingText
		: exactMoney(value === 0 ? 0 : value);
