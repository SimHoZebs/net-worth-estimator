import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import type { Account } from "../domain/model.ts";
import { AccountIcon } from "./AccountIcon.tsx";
import "./AccountIcon.css";

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
		<li className="account-entry">
			{account ? (
				<AccountIcon account={account} />
			) : (
				<span
					className={`account-entry-external account-entry-${external}`}
					aria-hidden="true"
				>
					<ExternalIcon size={15} strokeWidth={2} />
				</span>
			)}
			<span className="account-entry-name">
				<strong>{name}</strong>
				<small>{caption}</small>
			</span>
			{value !== undefined && (
				<strong className="account-entry-value">{value}</strong>
			)}
		</li>
	);
}
