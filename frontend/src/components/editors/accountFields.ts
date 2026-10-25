import type { Account, Plan } from "../../domain/model.ts";
import { upsertItem } from "../../domain/planEdits.ts";

/** System-owned account fields never come from the form. Both the overlay
 * editor and the detail editor preserve them from the stored account. */
export function preservedAccountMeta(
	item: Account | null,
	plan: Plan,
): {
	observedOn: string;
	source: string;
	color: string | null;
	archived: boolean;
} {
	return {
		observedOn: item?.observedOn ?? plan.startDate,
		source: item?.source ?? "Manual entry",
		color: item?.color ?? null,
		archived: item?.archived ?? false,
	};
}

export function upsertAccount(plan: Plan, account: Account): Plan {
	return {
		...plan,
		accounts: upsertItem({ items: plan.accounts, item: account }),
	};
}

export function newAccountId(item: Account | null): string {
	return item?.id ?? crypto.randomUUID();
}
