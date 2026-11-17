import { exactMoney } from "@/domain/format.ts";

/** Shared money rendering for the safe spending cards: a missing value reads
 * as an em dash instead of a fabricated zero. */
export const amountText = (value: number | null | undefined): string =>
	value === null || value === undefined ? "—" : exactMoney(value);
