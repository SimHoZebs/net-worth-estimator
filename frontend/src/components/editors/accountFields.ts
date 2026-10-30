import { todayIso } from "../../domain/format.ts";
import type { Account } from "../../domain/model.ts";
import type { BackendAccount } from "../../api/contracts.ts";
import type { AccountBody } from "@/api/generated/model/accountBody.ts";

/**
 * System-owned account fields never come from the form. The detail editor
 * preserves them from the canonical saved row; the form only carries
 * name/kind/enabled/balances.
 */
export function preservedAccountMeta(item: Account | null): {
	observedOn: string;
	source: string;
	color: string | null;
	archived: boolean;
} {
	return {
		observedOn: item?.observedOn ?? todayIso(),
		source: item?.source ?? "Manual entry",
		color: item?.color ?? null,
		archived: item?.archived ?? false,
	};
}

export interface AccountEditValues {
	name: string;
	kind: Account["kind"];
	enabled: boolean;
	balance: number;
	minBalance: number;
	maxBalance: number | null;
	noCeiling: boolean;
}

/**
 * Update account body. Display rows clamp missing/negative floors to 0 and
 * missing ceilings (or the no-ceiling sentinel) to null, so writing display
 * values back verbatim can invent a real floor or drop a sentinel. Unedited
 * bounds ride verbatim from the canonical raw account; only edited bounds
 * use the form values. An omitted maxBalance clears the ceiling server-side.
 */
export function accountUpdateBody({
	baseline,
	raw,
	values,
}: {
	baseline: Account;
	raw: BackendAccount | null | undefined;
	values: AccountEditValues;
}): AccountBody {
	const minEdited = values.minBalance !== baseline.minBalance;
	const maxEdited =
		values.noCeiling !== (baseline.maxBalance === null) ||
		(!values.noCeiling && values.maxBalance !== baseline.maxBalance);
	// Without a cached raw row, fall back to the display baseline: the same
	// values the form was opened with.
	const rawMin = raw ? raw.minBalance : baseline.minBalance;
	const rawMax = raw ? raw.maxBalance : baseline.maxBalance;
	const rawColor = raw ? raw.color : baseline.color;
	return {
		name: values.name,
		kind: values.kind,
		enabled: values.enabled,
		...(minEdited
			? { minBalance: values.minBalance }
			: rawMin != null
				? { minBalance: rawMin }
				: {}),
		...(maxEdited
			? values.noCeiling || values.maxBalance === null
				? {}
				: { maxBalance: values.maxBalance }
			: rawMax != null
				? { maxBalance: rawMax }
				: {}),
		...(rawColor ? { color: rawColor } : {}),
	};
}
