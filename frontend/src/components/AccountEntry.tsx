import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { Account } from "../domain/model.ts";
import { AccountIcon } from "./AccountIcon.tsx";

export type AccountEntryAccount = Pick<Account, "id" | "kind" | "color">;

// One row of a money flow: the same account glyph used in the plan and
// account views grouped with its value, so the user recognizes the account
// instead of reading a text row. A null account is an external endpoint and
// keeps the directional icon language from the transaction views. The value
// is optional: without one the row is pure identity, as a section head.
export function AccountEntry({
	account,
	name,
	caption,
	value,
	external,
}: {
	account: AccountEntryAccount | null;
	name: string;
	caption: string;
	value?: string;
	external?: "in" | "out";
}) {
	const ExternalIcon = external === "in" ? ArrowDownLeft : ArrowUpRight;
	return (
		<li className="flex min-w-0 items-center gap-3">
			{account ? (
				<AccountIcon account={account} size="sm" />
			) : (
				<span
					className={`grid size-8 shrink-0 place-items-center rounded-full ${external === "in" ? "bg-success-bg text-success-text" : external === "out" ? "bg-warning-bg text-warning-text" : ""}`}
					aria-hidden="true"
				>
					<ExternalIcon size={15} strokeWidth={2} />
				</span>
			)}
			<span className="flex min-w-0 flex-1 flex-col gap-0.5">
				<strong className="truncate text-xs font-semibold">{name}</strong>
				<small className="text-xs text-muted">{caption}</small>
			</span>
			{value !== undefined && (
				<strong className="whitespace-nowrap text-sm font-semibold tracking-[-0.3px] tabular-nums">
					{value}
				</strong>
			)}
		</li>
	);
}
