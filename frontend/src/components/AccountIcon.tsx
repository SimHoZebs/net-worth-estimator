import {
	Building2,
	Home,
	Landmark,
	type LucideIcon,
	PiggyBank,
	Wallet,
} from "lucide-react";
import type { Account } from "../domain/model.ts";
import { cssVariables } from "./cssVariables.ts";
import "./AccountIcon.css";

const icons: Record<Account["kind"], LucideIcon> = {
	cash: Wallet,
	investment: Landmark,
	property: Home,
	debt: Building2,
};

export function AccountIcon({
	account,
}: {
	account: Pick<Account, "id" | "kind" | "color">;
}) {
	const Icon = account.id === "savings" ? PiggyBank : icons[account.kind];
	return (
		<span
			className={`account-icon account-${account.kind}${account.color ? " account-custom-color" : ""}`}
			style={
				account.color
					? cssVariables({ "--account-color": account.color })
					: undefined
			}
		>
			<Icon size={19} strokeWidth={1.7} aria-hidden="true" />
		</span>
	);
}

export function AccountDot({ color }: { color: Account["color"] }) {
	return (
		<i
			className="account-dot"
			style={color ? cssVariables({ "--account-color": color }) : undefined}
			aria-hidden="true"
		/>
	);
}

// Shared icon-plus-name row used by the accounts table and the safe-card
// configure toggles. Render inside a `.table-name` parent, which owns the
// flex layout, gap, and text stack; the wrappers stay separate because one
// navigates while the other toggles a pressed state.
export function AccountLabel({
	account,
	suffix,
}: {
	account: Pick<Account, "id" | "kind" | "color" | "name">;
	suffix?: string;
}) {
	return (
		<>
			<AccountIcon account={account} />
			<span>
				<strong>{account.name}</strong>
				<small>
					{account.kind}
					{suffix}
				</small>
			</span>
		</>
	);
}
